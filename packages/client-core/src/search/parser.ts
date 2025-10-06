import {
  type SearchExpression,
  type SearchField,
  type SearchOperator,
  type SearchParseError,
  type SearchParseResult,
  type SearchTerm,
  type SearchTermExpression,
  type SearchValue
} from "./types";

interface TokenBase {
  readonly position: number;
}

type OperatorTokenValue = ":" | "=" | "!=" | ">" | ">=" | "<" | "<=";

type Token =
  | (TokenBase & { readonly type: "lparen" })
  | (TokenBase & { readonly type: "rparen" })
  | (TokenBase & { readonly type: "lbracket" })
  | (TokenBase & { readonly type: "rbracket" })
  | (TokenBase & { readonly type: "range" })
  | (TokenBase & { readonly type: "operator"; readonly value: OperatorTokenValue })
  | (TokenBase & { readonly type: "identifier"; readonly value: string })
  | (TokenBase & { readonly type: "string"; readonly value: string })
  | (TokenBase & { readonly type: "logical"; readonly value: "AND" | "OR" | "NOT" })
  | (TokenBase & { readonly type: "tag"; readonly value: string });

interface TokenizeResult {
  readonly tokens: readonly Token[];
  readonly errors: SearchParseError[];
}

const isWhitespace = (char: string): boolean => /\s/.test(char);

const isIdentifierBoundary = (char: string): boolean => {
  return ["(", ")", "[", "]", ":", ">", "<", "=", "!", ","].includes(char);
};

const toLogical = (value: string): "AND" | "OR" | "NOT" | null => {
  const upper = value.toUpperCase();
  if (upper === "AND" || upper === "OR" || upper === "NOT") {
    return upper;
  }
  return null;
};

const tokenize = (input: string): TokenizeResult => {
  const tokens: Token[] = [];
  const errors: SearchParseError[] = [];
  let index = 0;

  const pushToken = (token: Token) => {
    tokens.push(token);
  };

  while (index < input.length) {
    const char = input[index];
    if (isWhitespace(char)) {
      index += 1;
      continue;
    }

    if (char === "(") {
      pushToken({ type: "lparen", position: index });
      index += 1;
      continue;
    }
    if (char === ")") {
      pushToken({ type: "rparen", position: index });
      index += 1;
      continue;
    }
    if (char === "[") {
      pushToken({ type: "lbracket", position: index });
      index += 1;
      continue;
    }
    if (char === "]") {
      pushToken({ type: "rbracket", position: index });
      index += 1;
      continue;
    }

    if (char === ":") {
      pushToken({ type: "operator", value: ":", position: index });
      index += 1;
      continue;
    }

    if (char === "!" || char === "<" || char === ">") {
      const next = input[index + 1];
      if (next === "=") {
        pushToken({
          type: "operator",
          value: `${char}=` as OperatorTokenValue,
          position: index
        });
        index += 2;
        continue;
      }
      if (char === "!") {
        pushToken({ type: "operator", value: "!=" as OperatorTokenValue, position: index });
        index += 1;
        continue;
      }
      pushToken({ type: "operator", value: char as OperatorTokenValue, position: index });
      index += 1;
      continue;
    }

    if (char === "=") {
      pushToken({ type: "operator", value: "=", position: index });
      index += 1;
      continue;
    }

    if (char === ".") {
      if (input[index + 1] === ".") {
        pushToken({ type: "range", position: index });
        index += 2;
        continue;
      }
    }

    if (char === "\"") {
      let value = "";
      let closed = false;
      let cursor = index + 1;
      while (cursor < input.length) {
        const current = input[cursor];
        if (current === "\\") {
          const next = input[cursor + 1];
          if (next !== undefined) {
            value += next;
            cursor += 2;
            continue;
          }
        }
        if (current === "\"") {
          closed = true;
          cursor += 1;
          break;
        }
        value += current;
        cursor += 1;
      }
      if (!closed) {
        errors.push({ message: "Unterminated quoted string", position: index });
        break;
      }
      pushToken({ type: "string", value, position: index });
      index = cursor;
      continue;
    }

    if (char === "#") {
      let value = "";
      let cursor = index + 1;
      while (cursor < input.length) {
        const current = input[cursor];
        if (isWhitespace(current) || isIdentifierBoundary(current) || current === "#") {
          break;
        }
        if (current === ")" || current === "(") {
          break;
        }
        value += current;
        cursor += 1;
      }
      if (value.length === 0) {
        errors.push({ message: "Empty tag shorthand", position: index });
        index += 1;
        continue;
      }
      pushToken({ type: "tag", value, position: index });
      index = cursor;
      continue;
    }

    let value = "";
    let cursor = index;
    while (cursor < input.length) {
      const current = input[cursor];
      if (isWhitespace(current) || isIdentifierBoundary(current) || current === "#" || current === "\"") {
        break;
      }
      if (current === "." && input[cursor + 1] === ".") {
        break;
      }
      value += current;
      cursor += 1;
    }

    if (value.length === 0) {
      errors.push({ message: `Unexpected character '${char}'`, position: index });
      index += 1;
      continue;
    }

    const logical = toLogical(value);
    if (logical) {
      pushToken({ type: "logical", value: logical, position: index });
    } else {
      pushToken({ type: "identifier", value, position: index });
    }
    index = cursor;
  }

  return { tokens, errors } satisfies TokenizeResult;
};

const FIELD_ALIASES: Record<string, SearchField> = {
  text: "text",
  path: "path",
  tag: "tag",
  tags: "tag",
  type: "type",
  created: "created",
  updated: "updated",
  modified: "updated"
};

const mapOperator = (token: OperatorTokenValue, field: SearchField): SearchOperator => {
  if (token === ":") {
    if (field === "created" || field === "updated") {
      return "equals";
    }
    return "contains";
  }
  switch (token) {
    case "=":
      return "equals";
    case "!=":
      return "notEquals";
    case ">":
      return "gt";
    case ">=":
      return "gte";
    case "<":
      return "lt";
    case "<=":
      return "lte";
    default:
      return "contains";
  }
};

const createStringValue = (raw: string): SearchValue => ({
  type: "string",
  value: raw
});

const createNumericValue = (
  field: SearchField,
  raw: string,
  position: number,
  errors: SearchParseError[]
): SearchValue | null => {
  const timestamp = Date.parse(raw);
  if (Number.isNaN(timestamp)) {
    errors.push({ message: `Unable to parse date value '${raw}'`, position });
    return null;
  }
  return {
    type: "number",
    value: timestamp
  } satisfies SearchValue;
};

const createValue = (
  field: SearchField,
  operator: SearchOperator,
  raw: string,
  position: number,
  errors: SearchParseError[]
): SearchValue | null => {
  if (field === "created" || field === "updated") {
    return createNumericValue(field, raw, position, errors);
  }
  if (operator === "gt" || operator === "gte" || operator === "lt" || operator === "lte") {
    return createStringValue(raw.toLocaleLowerCase());
  }
  return createStringValue(raw);
};

const createTermExpression = (
  field: SearchField,
  operator: SearchOperator,
  raw: string,
  position: number,
  errors: SearchParseError[]
): SearchTermExpression | null => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    errors.push({ message: "Empty value", position });
    return null;
  }
  const value = createValue(field, operator, trimmed, position, errors);
  if (!value) {
    return null;
  }
  const term: SearchTerm = {
    field,
    operator,
    value
  } satisfies SearchTerm;
  return {
    kind: "term",
    term
  } satisfies SearchTermExpression;
};

class Parser {
  private readonly tokens: readonly Token[];
  private readonly errors: SearchParseError[];
  private current = 0;

  constructor(tokens: readonly Token[], errors: SearchParseError[]) {
    this.tokens = tokens;
    this.errors = errors;
  }

  parse(): SearchExpression | null {
    if (this.tokens.length === 0) {
      return null;
    }
    const expression = this.parseOr();
    if (!expression) {
      return null;
    }
    if (!this.isAtEnd()) {
      const token = this.peek();
      if (token) {
        this.errors.push({ message: "Unexpected token", position: token.position });
      }
    }
    return expression;
  }

  private parseOr(): SearchExpression | null {
    let left = this.parseAnd();
    if (!left) {
      return null;
    }
    while (this.matchLogical("OR")) {
      const right = this.parseAnd();
      if (!right) {
        this.errors.push({ message: "Missing expression after OR", position: this.previous()?.position ?? 0 });
        return left;
      }
      left = {
        kind: "or",
        left,
        right
      };
    }
    return left;
  }

  private parseAnd(): SearchExpression | null {
    let left = this.parseNot();
    if (!left) {
      return null;
    }
    let parsing = true;
    while (parsing) {
      if (this.matchLogical("AND")) {
        const right = this.parseNot();
        if (!right) {
          this.errors.push({ message: "Missing expression after AND", position: this.previous()?.position ?? 0 });
          return left;
        }
        left = {
          kind: "and",
          left,
          right
        };
        continue;
      }

      if (this.shouldParseImplicitAnd()) {
        const right = this.parseNot();
        if (!right) {
          break;
        }
        left = {
          kind: "and",
          left,
          right
        };
        continue;
      }
      parsing = false;
    }
    return left;
  }

  private parseNot(): SearchExpression | null {
    if (this.matchLogical("NOT")) {
      const operand = this.parseNot();
      if (!operand) {
        this.errors.push({ message: "Missing expression after NOT", position: this.previous()?.position ?? 0 });
        return null;
      }
      return {
        kind: "not",
        expression: operand
      };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): SearchExpression | null {
    if (this.match("lparen")) {
      const expression = this.parseOr();
      if (!this.match("rparen")) {
        this.errors.push({ message: "Unclosed group", position: this.previous()?.position ?? 0 });
      }
      return expression;
    }
    return this.parseTermExpression();
  }

  private parseTermExpression(): SearchExpression | null {
    const token = this.peek();
    if (!token) {
      return null;
    }

    if (token.type === "tag") {
      this.advance();
      return createTermExpression("tag", "contains", token.value, token.position, this.errors);
    }

    if (token.type === "string") {
      this.advance();
      return createTermExpression("text", "contains", token.value, token.position, this.errors);
    }

    if (token.type === "identifier") {
      this.advance();
      const lookahead = this.peek();
      if (lookahead && lookahead.type === "operator") {
        this.advance();
        const field = FIELD_ALIASES[token.value.toLocaleLowerCase()];
        if (!field) {
          this.errors.push({ message: `Unknown field '${token.value}'`, position: token.position });
          return this.parseImplicitTextTerm(token.value, token.position);
        }
        return this.parseFieldTerm(field, lookahead.value, token.position);
      }
      return this.parseImplicitTextTerm(token.value, token.position);
    }

    this.errors.push({ message: "Unexpected token", position: token.position });
    this.advance();
    return null;
  }

  private parseImplicitTextTerm(value: string, position: number): SearchExpression | null {
    return createTermExpression("text", "contains", value, position, this.errors);
  }

  private parseFieldTerm(
    field: SearchField,
    operatorToken: OperatorTokenValue,
    position: number
  ): SearchExpression | null {
    if (operatorToken === ":" && this.match("lbracket")) {
      return this.parseRangeExpression(field, position);
    }

    const valueToken = this.peek();
    if (!valueToken || (valueToken.type !== "identifier" && valueToken.type !== "string" && valueToken.type !== "tag")) {
      this.errors.push({ message: "Missing value for field expression", position });
      return null;
    }
    this.advance();
    const raw = valueToken.value;
    const operator = mapOperator(operatorToken, field);
    return createTermExpression(field, operator, raw, valueToken.position, this.errors);
  }

  private parseRangeExpression(field: SearchField, position: number): SearchExpression | null {
    const startToken = this.peek();
    let startValue: string | null = null;
    if (startToken && (startToken.type === "identifier" || startToken.type === "string" || startToken.type === "tag")) {
      this.advance();
      startValue = startToken.value;
    }
    if (!this.match("range")) {
      this.errors.push({ message: "Expected '..' in range expression", position: startToken?.position ?? position });
      this.consumeUntil("rbracket");
      return null;
    }
    const endToken = this.peek();
    let endValue: string | null = null;
    if (endToken && (endToken.type === "identifier" || endToken.type === "string" || endToken.type === "tag")) {
      this.advance();
      endValue = endToken.value;
    }
    if (!this.match("rbracket")) {
      this.errors.push({ message: "Unclosed range", position });
    }

    const expressions: SearchExpression[] = [];
    if (startValue !== null && startValue.length > 0) {
      const startTerm = createTermExpression(field, "gte", startValue, position, this.errors);
      if (startTerm) {
        expressions.push(startTerm);
      }
    }
    if (endValue !== null && endValue.length > 0) {
      const endTerm = createTermExpression(field, "lte", endValue, position, this.errors);
      if (endTerm) {
        expressions.push(endTerm);
      }
    }

    if (expressions.length === 0) {
      this.errors.push({ message: "Empty range", position });
      return null;
    }
    if (expressions.length === 1) {
      return expressions[0] ?? null;
    }
    return {
      kind: "and",
      left: expressions[0]!,
      right: expressions[1]!
    };
  }

  private shouldParseImplicitAnd(): boolean {
    const next = this.peek();
    if (!next) {
      return false;
    }
    if (next.type === "rparen" || next.type === "rbracket") {
      return false;
    }
    if (next.type === "logical" && next.value === "OR") {
      return false;
    }
    return true;
  }

  private consumeUntil(type: Token["type"]): void {
    while (!this.isAtEnd()) {
      if (this.peek()?.type === type) {
        this.advance();
        return;
      }
      this.advance();
    }
  }

  private match(type: Token["type"]): boolean {
    if (this.check(type)) {
      this.advance();
      return true;
    }
    return false;
  }

  private matchLogical(value: "AND" | "OR" | "NOT"): boolean {
    const token = this.peek();
    if (token && token.type === "logical" && token.value === value) {
      this.advance();
      return true;
    }
    return false;
  }

  private check(type: Token["type"]): boolean {
    if (this.isAtEnd()) {
      return false;
    }
    return this.peek()?.type === type;
  }

  private advance(): Token | null {
    if (!this.isAtEnd()) {
      this.current += 1;
    }
    return this.previous();
  }

  private isAtEnd(): boolean {
    return this.current >= this.tokens.length;
  }

  private peek(): Token | null {
    return this.tokens[this.current] ?? null;
  }

  private previous(): Token | null {
    return this.tokens[this.current - 1] ?? null;
  }
}

export const parseSearchQuery = (query: string): SearchParseResult => {
  const { tokens, errors } = tokenize(query);
  const parser = new Parser(tokens, errors);
  const expression = parser.parse();
  return {
    expression,
    errors
  } satisfies SearchParseResult;
};
