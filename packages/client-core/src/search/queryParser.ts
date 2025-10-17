import {
  type SearchComparator,
  type SearchDateLiteral,
  type SearchExpression,
  type SearchField,
  type SearchLiteral,
  type SearchPredicateExpression,
  type SearchRangeLiteral,
  type SearchStringLiteral
} from "./types";

export interface ParseError {
  readonly message: string;
  /** Zero-based column index measured in UTF-16 code units. */
  readonly start: number;
  /** Exclusive upper bound of the invalid span when available. */
  readonly end?: number;
}

export type ParseResult =
  | {
      readonly type: "success";
      readonly expression: SearchExpression;
    }
  | {
      readonly type: "error";
      readonly error: ParseError;
    };

const FIELD_NAMES: ReadonlySet<SearchField> = new Set(["text", "path", "tag", "type", "created", "updated"]);

interface TokenBase {
  readonly start: number;
  readonly end: number;
}

interface IdentifierToken extends TokenBase {
  readonly type: "identifier";
  readonly value: string;
}

interface StringToken extends TokenBase {
  readonly type: "string";
  readonly value: string;
}

interface OperatorToken extends TokenBase {
  readonly type: "operator";
  readonly value: SearchComparator;
}

interface ParenToken extends TokenBase {
  readonly type: "lparen" | "rparen";
}

interface BooleanToken extends TokenBase {
  readonly type: "boolean";
  readonly value: "AND" | "OR" | "NOT";
}

interface RangeBracketToken extends TokenBase {
  readonly type: "rangeStart" | "rangeEnd";
}

interface RangeSeparatorToken extends TokenBase {
  readonly type: "rangeSeparator";
}

interface TagShorthandToken extends TokenBase {
  readonly type: "tagShorthand";
  readonly value: string;
}

type Token =
  | IdentifierToken
  | StringToken
  | OperatorToken
  | ParenToken
  | BooleanToken
  | RangeBracketToken
  | RangeSeparatorToken
  | TagShorthandToken;

export const parseSearchQuery = (input: string): ParseResult => {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return {
      type: "error",
      error: {
        message: "Query is empty.",
        start: 0,
        end: 0
      }
    };
  }

  const tokens = tokenize(trimmed);
  if ("error" in tokens) {
    return { type: "error", error: tokens.error };
  }

  const parser = new Parser(tokens.tokens);
  const expression = parser.parseExpression();
  if (!expression) {
    return {
      type: "error",
      error: parser.lastError ?? {
        message: "Unable to parse query.",
        start: 0,
        end: input.length
      }
    };
  }
  if (!parser.isAtEnd()) {
    const token = parser.peek();
    return {
      type: "error",
      error: {
        message: `Unexpected token "${input.substring(token.start, token.end)}".`,
        start: token.start,
        end: token.end
      }
    };
  }
  return { type: "success", expression };
};

class Parser {
  private readonly tokens: readonly Token[];
  private index = 0;
  public lastError: ParseError | null = null;

  constructor(tokens: readonly Token[]) {
    this.tokens = tokens;
  }

  isAtEnd(): boolean {
    return this.index >= this.tokens.length;
  }

  peek(): Token {
    return this.tokens[this.index]!;
  }

  consume(): Token {
    return this.tokens[this.index++]!;
  }

  parseExpression(minPrecedence = 0): SearchExpression | null {
    const left = this.parseUnary();
    if (!left) {
      return null;
    }

    return this.parseBinaryRhs(left, minPrecedence);
  }

  private parseBinaryRhs(left: SearchExpression, minPrecedence: number): SearchExpression | null {
    while (!this.isAtEnd()) {
      const token = this.peek();
      const explicitOperator = this.parseBooleanOperator(token);
      const implicit = !explicitOperator && this.canStartPrimary(token);

      if (!explicitOperator && !implicit) {
        break;
      }

      const operator = explicitOperator ?? "AND";
      const precedence = operator === "OR" ? 1 : 2;
      if (precedence < minPrecedence) {
        break;
      }

      if (explicitOperator) {
        this.consume(); // consume explicit AND/OR
      }

      const right = this.parseExpression(precedence + 1);
      if (!right) {
        return null;
      }
      left = {
        type: "binary",
        operator,
        left,
        right
      };
    }
    return left;
  }

  private parseBooleanOperator(token: Token): "AND" | "OR" | null {
    if (token.type === "boolean" && (token.value === "AND" || token.value === "OR")) {
      return token.value;
    }
    return null;
  }

  private canStartPrimary(token: Token): boolean {
    switch (token.type) {
      case "identifier":
      case "string":
      case "lparen":
      case "tagShorthand":
        return true;
      case "boolean":
        return token.value === "NOT";
      default:
        return false;
    }
  }

  private parseUnary(): SearchExpression | null {
    if (!this.isAtEnd()) {
      const token = this.peek();
      if (token.type === "boolean" && token.value === "NOT") {
        this.consume();
        const operand = this.parseExpression(3);
        if (!operand) {
          this.recordError({
            message: "NOT must be followed by an expression.",
            start: token.start,
            end: token.end
          });
          return null;
        }
        return {
          type: "not",
          operand
        };
      }
    }

    return this.parsePrimary();
  }

  private parsePrimary(): SearchExpression | null {
    if (this.isAtEnd()) {
      return this.unexpectedEnd();
    }
    const token = this.consume();
    if (token.type === "lparen") {
      const expression = this.parseExpression();
      if (!expression) {
        return null;
      }
      if (this.isAtEnd() || this.peek().type !== "rparen") {
        this.recordError({
          message: "Missing closing parenthesis.",
          start: token.start,
          end: token.end
        });
        return null;
      }
      this.consume(); // closing )
      return {
        type: "group",
        expression
      };
    }

    if (token.type === "tagShorthand") {
      return this.createPredicate("tag", ":", this.toStringLiteral(token.value));
    }

    if (token.type === "identifier") {
      const field = this.asField(token.value);
      if (field) {
        return this.parseFieldPredicate(field, token);
      }
      return this.parseDefaultPredicate(token.value);
    }

    if (token.type === "string") {
      return this.createPredicate("text", ":", this.toStringLiteral(token.value));
    }

    this.recordError({
      message: `Unexpected token "${this.serializeToken(token)}".`,
      start: token.start,
      end: token.end
    });
    return null;
  }

  private parseDefaultPredicate(rawValue: string): SearchPredicateExpression {
    const literal = this.toStringLiteral(rawValue.trim());
    return {
      type: "predicate",
      field: "text",
      comparator: ":",
      value: literal
    };
  }

  private parseFieldPredicate(field: SearchField, fieldToken: Token): SearchExpression | null {
    if (this.isAtEnd()) {
      this.recordError({
        message: `Expected comparator after field "${this.serializeToken(fieldToken)}".`,
        start: fieldToken.start,
        end: fieldToken.end
      });
      return null;
    }
    const operatorToken = this.consume();
    if (operatorToken.type !== "operator") {
      this.recordError({
        message: `Expected comparison operator after field "${this.serializeToken(fieldToken)}".`,
        start: operatorToken.start,
        end: operatorToken.end
      });
      return null;
    }

    const comparator = operatorToken.value;
    if (comparator === ":" && !this.isAtEnd() && this.peek().type === "rangeStart") {
      return this.parseRangePredicate(field, comparator, operatorToken);
    }

    const literal = this.parseLiteral(field);
    if (!literal) {
      return null;
    }

    return this.createPredicate(field, comparator, literal);
  }

  private parseRangePredicate(
    field: SearchField,
    comparator: SearchComparator,
    operatorToken: Token
  ): SearchExpression | null {
    const rangeToken = this.consume(); // rangeStart
    if (rangeToken.type !== "rangeStart") {
      this.recordError({
        message: "Expected '[' to start range literal.",
        start: operatorToken.start,
        end: operatorToken.end
      });
      return null;
    }

    let startLiteral: SearchLiteral | undefined;
    let endLiteral: SearchLiteral | undefined;

    if (!this.isAtEnd() && this.peek().type !== "rangeSeparator") {
      const parsedStart = this.parseLiteral(field);
      if (!parsedStart) {
        return null;
      }
      startLiteral = parsedStart;
    }

    if (this.isAtEnd()) {
      this.recordError({
        message: "Range literals must include '..' separator.",
        start: rangeToken.start,
        end: rangeToken.end
      });
      return null;
    }

    const separator = this.consume();
    if (separator.type !== "rangeSeparator") {
      this.recordError({
        message: "Range literals must include '..' separator.",
        start: separator.start,
        end: separator.end
      });
      return null;
    }

    if (!this.isAtEnd() && this.peek().type !== "rangeEnd") {
      const parsedEnd = this.parseLiteral(field);
      if (!parsedEnd) {
        return null;
      }
      endLiteral = parsedEnd;
    }

    if (this.isAtEnd() || this.peek().type !== "rangeEnd") {
      this.recordError({
        message: "Missing closing ']' for range literal.",
        start: rangeToken.start,
        end: rangeToken.end
      });
      return null;
    }
    this.consume(); // rangeEnd

    return this.createPredicate(field, comparator, {
      kind: "range",
      ...(startLiteral ? { start: startLiteral } : {}),
      ...(endLiteral ? { end: endLiteral } : {})
    });
  }

  private parseLiteral(field: SearchField): SearchLiteral | null {
    if (this.isAtEnd()) {
      this.recordError({
        message: "Missing literal value.",
        start: this.lastTokenEnd(),
        end: this.lastTokenEnd()
      });
      return null;
    }
    const token = this.consume();
    if (token.type === "string" || token.type === "identifier") {
      return this.createLiteralForField(field, token.value);
    }

    if (token.type === "tagShorthand") {
      return this.createLiteralForField(field, token.value);
    }

    this.recordError({
      message: `Unexpected token "${this.serializeToken(token)}" where a literal was expected.`,
      start: token.start,
      end: token.end
    });
    return null;
  }

  private createLiteralForField(field: SearchField, raw: string): SearchLiteral {
    if (field === "created" || field === "updated") {
      const timestamp = Date.parse(raw);
      if (!Number.isNaN(timestamp)) {
        return {
          kind: "date",
          value: timestamp,
          raw
        } satisfies SearchDateLiteral;
      }
    }
    return this.toStringLiteral(raw);
  }

  private createPredicate(
    field: SearchField,
    comparator: SearchComparator,
    value: SearchLiteral | SearchRangeLiteral
  ): SearchPredicateExpression {
    return {
      type: "predicate",
      field,
      comparator,
      value
    };
  }

  private toStringLiteral(value: string): SearchStringLiteral {
    return {
      kind: "string",
      value: value.toLowerCase()
    };
  }

  private unexpectedEnd(): null {
    this.recordError({
      message: "Unexpected end of query.",
      start: this.lastTokenEnd(),
      end: this.lastTokenEnd()
    });
    return null;
  }

  private lastTokenEnd(): number {
    if (this.index === 0) {
      return 0;
    }
    return this.tokens[Math.min(this.index, this.tokens.length) - 1]!.end;
  }

  private serializeToken(token: Token): string {
    switch (token.type) {
      case "identifier":
      case "string":
      case "operator":
      case "boolean":
      case "tagShorthand":
        return token.value.toString();
      case "lparen":
        return "(";
      case "rparen":
        return ")";
      case "rangeStart":
        return "[";
      case "rangeEnd":
        return "]";
      case "rangeSeparator":
        return "..";
      default:
        return "";
    }
  }

  private asField(raw: string): SearchField | null {
    const normalized = raw.toLowerCase();
    return FIELD_NAMES.has(normalized as SearchField) ? (normalized as SearchField) : null;
  }

  private recordError(error: ParseError): void {
    if (!this.lastError) {
      this.lastError = error;
    }
  }
}

const tokenize = (input: string): { tokens: Token[] } | { error: ParseError } => {
  const tokens: Token[] = [];
  let index = 0;

  const commitToken = <T extends Token>(token: T): void => {
    tokens.push(token);
  };

  while (index < input.length) {
    const char = input[index]!;
    if (isWhitespace(char)) {
      index += 1;
      continue;
    }

    if (char === "(") {
      commitToken({
        type: "lparen",
        start: index,
        end: index + 1
      });
      index += 1;
      continue;
    }
    if (char === ")") {
      commitToken({
        type: "rparen",
        start: index,
        end: index + 1
      });
      index += 1;
      continue;
    }
    if (char === "[") {
      commitToken({
        type: "rangeStart",
        start: index,
        end: index + 1
      });
      index += 1;
      continue;
    }
    if (char === "]") {
      commitToken({
        type: "rangeEnd",
        start: index,
        end: index + 1
      });
      index += 1;
      continue;
    }
    if (char === "." && input[index + 1] === ".") {
      commitToken({
        type: "rangeSeparator",
        start: index,
        end: index + 2
      });
      index += 2;
      continue;
    }

    if (char === '"' || char === "'") {
      const result = readQuotedString(input, index);
      if ("error" in result) {
        return { error: result.error };
      }
      commitToken({
        type: "string",
        value: result.value,
        start: index,
        end: result.nextIndex
      });
      index = result.nextIndex;
      continue;
    }

    if (char === "#") {
      const result = readIdentifier(input, index + 1);
      if (result.nextIndex === index + 1) {
        return {
          error: {
            message: "Tag shorthand must include at least one character.",
            start: index,
            end: index + 1
          }
        };
      }
      commitToken({
        type: "tagShorthand",
        value: input.slice(index + 1, result.nextIndex),
        start: index,
        end: result.nextIndex
      });
      index = result.nextIndex;
      continue;
    }

    const operator = matchOperator(input, index);
    if (operator) {
      commitToken({
        type: "operator",
        value: operator.operator,
        start: index,
        end: index + operator.length
      });
      index += operator.length;
      continue;
    }

    const identifierResult = readIdentifier(input, index);
    if (identifierResult.nextIndex === index) {
      return {
        error: {
          message: `Unexpected character "${char}".`,
          start: index,
          end: index + 1
        }
      };
    }
    const rawValue = input.slice(index, identifierResult.nextIndex);
    const upper = rawValue.toUpperCase();
    if (upper === "AND" || upper === "OR" || upper === "NOT") {
      commitToken({
        type: "boolean",
        value: upper,
        start: index,
        end: identifierResult.nextIndex
      });
    } else {
      commitToken({
        type: "identifier",
        value: rawValue,
        start: index,
        end: identifierResult.nextIndex
      });
    }
    index = identifierResult.nextIndex;
  }

  return { tokens };
};

const readQuotedString = (
  input: string,
  start: number
): { value: string; nextIndex: number } | { error: ParseError } => {
  const quote = input[start]!;
  let index = start + 1;
  let value = "";
  while (index < input.length) {
    const char = input[index]!;
    if (char === "\\" && index + 1 < input.length) {
      value += input[index + 1]!;
      index += 2;
      continue;
    }
    if (char === quote) {
      return { value, nextIndex: index + 1 };
    }
    value += char;
    index += 1;
  }
  return {
    error: {
      message: "Unterminated string literal.",
      start,
      end: input.length
    }
  };
};

const readIdentifier = (input: string, start: number): { nextIndex: number } => {
  let index = start;
  while (index < input.length) {
    const char = input[index]!;
    if (isIdentifierChar(char)) {
      index += 1;
      continue;
    }
    break;
  }
  return { nextIndex: index };
};

const matchOperator = (
  input: string,
  start: number
): { operator: SearchComparator; length: number } | null => {
  const twoChar = input.slice(start, start + 2);
  switch (twoChar) {
    case ">=":
    case "<=":
    case "!=":
      return { operator: twoChar as SearchComparator, length: 2 };
    default:
      break;
  }
  switch (input[start]) {
    case ":":
    case "=":
    case ">":
    case "<":
      return { operator: input[start] as SearchComparator, length: 1 };
    default:
      return null;
  }
};

const isWhitespace = (char: string): boolean => /\s/u.test(char);

const isIdentifierChar = (char: string): boolean => /[^\s()[\].:#"'\\]/u.test(char);
