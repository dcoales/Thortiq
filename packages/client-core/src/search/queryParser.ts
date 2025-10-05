/**
 * Recursive descent parser for the search query language. Supports fields, operators,
 * boolean logic, grouping, quoted strings, and tag shorthand.
 */
import type { SearchQuery, SearchField, SearchOperator, SearchFieldQuery, SearchBooleanQuery, SearchGroupQuery } from "./types";
import { SearchParseError } from "./types";

export { SearchParseError };

/**
 * Parses a search query string into an AST.
 */
export const parseSearchQuery = (query: string): SearchQuery => {
  const tokens = tokenize(query);
  const parser = new QueryParser(tokens);
  return parser.parseQuery();
};

/**
 * Tokenizes the query string into an array of tokens.
 */
const tokenize = (query: string): Token[] => {
  const tokens: Token[] = [];
  let position = 0;
  
  while (position < query.length) {
    const char = query[position];
    
    // Skip whitespace
    if (/\s/.test(char)) {
      position++;
      continue;
    }
    
    // Handle operators
    if (char === ":" || char === "=" || char === "!" || char === ">" || char === "<") {
      const nextChar = query[position + 1];
      if (char === "!" && nextChar === "=") {
        tokens.push({ type: "operator", value: "!=", position });
        position += 2;
      } else if (char === ">" && nextChar === "=") {
        tokens.push({ type: "operator", value: ">=", position });
        position += 2;
      } else if (char === "<" && nextChar === "=") {
        tokens.push({ type: "operator", value: "<=", position });
        position += 2;
      } else {
        tokens.push({ type: "operator", value: char, position });
        position++;
      }
      continue;
    }
    
    // Handle parentheses
    if (char === "(" || char === ")") {
      tokens.push({ type: "paren", value: char, position });
      position++;
      continue;
    }
    
    // Handle quoted strings
    if (char === '"') {
      const start = position;
      position++; // Skip opening quote
      let value = "";
      while (position < query.length && query[position] !== '"') {
        value += query[position];
        position++;
      }
      if (position >= query.length) {
        throw new SearchParseError("Unclosed quoted string", start);
      }
      position++; // Skip closing quote
      tokens.push({ type: "quoted", value, position: start });
      continue;
    }
    
    // Handle identifiers and keywords
    let value = "";
    const start = position;
    while (position < query.length && !/[:\s=!><()"]/.test(query[position])) {
      value += query[position];
      position++;
    }
    
    if (value) {
      const upperValue = value.toUpperCase();
      if (upperValue === "AND" || upperValue === "OR" || upperValue === "NOT") {
        tokens.push({ type: "keyword", value: upperValue, position: start });
      } else if (value.startsWith("#")) {
        tokens.push({ type: "tag", value: value.slice(1), position: start });
      } else if (isValidField(value)) {
        tokens.push({ type: "field", value, position: start });
      } else {
        tokens.push({ type: "identifier", value, position: start });
      }
    }
  }
  
  return tokens;
};

/**
 * Checks if a string is a valid search field.
 */
const isValidField = (value: string): value is SearchField => {
  return ["text", "path", "tag", "type", "created", "updated"].includes(value);
};

/**
 * Token types for the lexer.
 */
interface Token {
  readonly type: "field" | "operator" | "keyword" | "identifier" | "quoted" | "tag" | "paren";
  readonly value: string;
  readonly position: number;
}

/**
 * Recursive descent parser implementation.
 */
class QueryParser {
  private position = 0;
  
  constructor(private readonly tokens: readonly Token[]) {}
  
  parseQuery(): SearchQuery {
    const query = this.parseOrExpression();
    if (this.position < this.tokens.length) {
      throw new SearchParseError("Unexpected token after query", this.tokens[this.position].position);
    }
    return query;
  }
  
  private parseOrExpression(): SearchQuery {
    let left = this.parseAndExpression();
    
    while (this.match("keyword", "OR")) {
      this.advance();
      const right = this.parseAndExpression();
      left = {
        type: "boolean",
        operator: "OR",
        left,
        right
      } satisfies SearchBooleanQuery;
    }
    
    return left;
  }
  
  private parseAndExpression(): SearchQuery {
    let left = this.parseNotExpression();
    
    while (this.match("keyword", "AND")) {
      this.advance();
      const right = this.parseNotExpression();
      left = {
        type: "boolean",
        operator: "AND",
        left,
        right
      } satisfies SearchBooleanQuery;
    }
    
    return left;
  }
  
  private parseNotExpression(): SearchQuery {
    if (this.match("keyword", "NOT")) {
      this.advance();
      const query = this.parsePrimaryExpression();
      return {
        type: "boolean",
        operator: "NOT",
        left: query
      } satisfies SearchBooleanQuery;
    }
    
    const query = this.parsePrimaryExpression();
    
    // Handle implicit AND for consecutive identifiers
    if (this.match("identifier")) {
      const right = this.parseNotExpression(); // Recursively parse the rest
      return {
        type: "boolean",
        operator: "AND",
        left: query,
        right
      } satisfies SearchBooleanQuery;
    }
    
    return query;
  }
  
  private parsePrimaryExpression(): SearchQuery {
    if (this.match("paren", "(")) {
      this.advance(); // Consume opening paren
      const query = this.parseOrExpression();
      if (!this.match("paren", ")")) {
        throw new SearchParseError("Expected closing parenthesis", this.current()?.position);
      }
      this.advance(); // Consume closing paren
      return {
        type: "group",
        query
      } satisfies SearchGroupQuery;
    }
    
    return this.parseFieldQuery();
  }
  
  private parseFieldQuery(): SearchQuery {
    // Handle tag shorthand (#tagName)
    if (this.match("tag")) {
      const tagToken = this.current()!;
      this.advance();
      return {
        type: "field",
        field: "tag",
        operator: ":",
        value: tagToken.value
      } satisfies SearchFieldQuery;
    }
    
    // Handle field:value or field=value syntax
    if (this.match("field")) {
      const fieldToken = this.current()!;
      this.advance();
      
      if (!this.match("operator")) {
        throw new SearchParseError("Expected operator after field", this.current()?.position);
      }
      
      const operatorToken = this.current()!;
      const operator = operatorToken.value as SearchOperator;
      this.advance();
      
      if (!this.match("identifier") && !this.match("quoted")) {
        throw new SearchParseError("Expected value after operator", this.current()?.position);
      }
      
      const valueToken = this.current()!;
      this.advance();
      
      return {
        type: "field",
        field: fieldToken.value as SearchField,
        operator,
        value: valueToken.value
      } satisfies SearchFieldQuery;
    }
    
    // Handle bare identifier (defaults to text search)
    if (this.match("identifier")) {
      const valueToken = this.current()!;
      this.advance();
      return {
        type: "field",
        field: "text",
        operator: ":",
        value: valueToken.value
      } satisfies SearchFieldQuery;
    }
    
    throw new SearchParseError("Expected field query or identifier", this.current()?.position);
  }
  
  private match(type: Token["type"], value?: string): boolean {
    const token = this.current();
    if (!token) return false;
    if (token.type !== type) return false;
    if (value !== undefined && token.value !== value) return false;
    return true;
  }
  
  private advance(): void {
    this.position++;
  }
  
  private current(): Token | undefined {
    return this.tokens[this.position];
  }
  
  private peek(offset: number = 1): Token | undefined {
    const index = this.position + offset;
    return this.tokens[index];
  }
}
