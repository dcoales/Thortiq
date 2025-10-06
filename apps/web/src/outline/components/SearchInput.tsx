/**
 * Search input component that replaces the breadcrumb when search is active.
 * Provides query input, execution, and error display.
 */
import React, { useState, useCallback, useEffect, useRef } from "react";
import { useSearchCommands } from "@thortiq/client-react";
import "./SearchInput.css";

export interface SearchInputProps {
  readonly paneId: string;
  readonly placeholder?: string;
  readonly className?: string;
}

export const SearchInput: React.FC<SearchInputProps> = ({
  paneId,
  placeholder = "Search...",
  className = ""
}) => {
  const searchCommands = useSearchCommands(paneId);
  const [localQuery, setLocalQuery] = useState(searchCommands.query);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  
  // Sync local query with search state
  useEffect(() => {
    setLocalQuery(searchCommands.query);
  }, [searchCommands.query]);
  
  // Focus input when search becomes active
  useEffect(() => {
    if (searchCommands.isActive && inputRef.current) {
      inputRef.current.focus();
    }
  }, [searchCommands.isActive]);
  
  const handleInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setLocalQuery(value);
    setError(null);
  }, []);
  
  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      try {
        searchCommands.executeSearch(localQuery);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Search failed");
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      searchCommands.clearAndClose();
    }
  }, [localQuery, searchCommands]);
  
  const handleClear = useCallback(() => {
    setLocalQuery("");
    setError(null);
    searchCommands.clearSearchQuery();
  }, [searchCommands]);
  
  const handleClose = useCallback(() => {
    searchCommands.clearAndClose();
  }, [searchCommands]);
  
  return (
    <div className={`search-input-container ${className}`}>
      <div className="search-input-wrapper">
        <input
          ref={inputRef}
          type="text"
          value={localQuery}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="search-input"
          autoComplete="off"
          spellCheck="false"
        />
        <div className="search-input-actions">
          {localQuery && (
            <button
              type="button"
              onClick={handleClear}
              className="search-clear-button"
              aria-label="Clear search"
            >
              ×
            </button>
          )}
          <button
            type="button"
            onClick={handleClose}
            className="search-close-button"
            aria-label="Close search"
          >
            ✕
          </button>
        </div>
      </div>
      {error && (
        <div className="search-error">
          {error}
        </div>
      )}
      {searchCommands.query && (
        <div className="search-results-count">
          {searchCommands.matchingNodeIds.length} result{searchCommands.matchingNodeIds.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
};
