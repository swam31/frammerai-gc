'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { DateRangeFilter, DimensionFilter, filtersApi } from './api';

export interface FilterOption {
  id: number;
  name: string;
}

interface FilterState {
  dateRange: DateRangeFilter;
  previousDateRange: DateRangeFilter | null;
  filters: DimensionFilter;
  // dropdown options
  companies: FilterOption[];
  channels: FilterOption[];
  users: FilterOption[];
  teams: FilterOption[];
  languages: FilterOption[];
  inputTypes: FilterOption[];
  outputTypes: FilterOption[];
  platforms: FilterOption[];
  dataDateRange: { min_date: string; max_date: string } | null;
  loading: boolean;
}

interface FilterContextType extends FilterState {
  setDateRange: (dr: DateRangeFilter) => void;
  setPreviousDateRange: (dr: DateRangeFilter | null) => void;
  setFilters: (f: DimensionFilter) => void;
  updateFilter: <K extends keyof DimensionFilter>(key: K, value: DimensionFilter[K]) => void;
  resetFilters: () => void;
}

const defaultFilters: DimensionFilter = {};

const FilterContext = createContext<FilterContextType | null>(null);

export function FilterProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<FilterState>({
    dateRange: {},
    previousDateRange: null,
    filters: defaultFilters,
    companies: [],
    channels: [],
    users: [],
    teams: [],
    languages: [],
    inputTypes: [],
    outputTypes: [],
    platforms: [],
    dataDateRange: null,
    loading: true,
  });

  useEffect(() => {
    async function loadOptions() {
      try {
        const [companies, channels, users, teams, languages, inputTypes, outputTypes, platforms, dateRange] = await Promise.all([
          filtersApi.companies().catch(() => []),
          filtersApi.channels().catch(() => []),
          filtersApi.users().catch(() => []),
          filtersApi.teams().catch(() => []),
          filtersApi.languages().catch(() => []),
          filtersApi.inputTypes().catch(() => []),
          filtersApi.outputTypes().catch(() => []),
          filtersApi.platforms().catch(() => []),
          filtersApi.dateRange().catch(() => null),
        ]);
        setState(prev => ({
          ...prev,
          companies: companies as FilterOption[],
          channels: (channels as FilterOption[]),
          users: (users as FilterOption[]),
          teams: teams as FilterOption[],
          languages: languages as FilterOption[],
          inputTypes: inputTypes as FilterOption[],
          outputTypes: outputTypes as FilterOption[],
          platforms: platforms as FilterOption[],
          dataDateRange: dateRange as { min_date: string; max_date: string } | null,
          dateRange: dateRange
            ? { start_date: dateRange.min_date, end_date: dateRange.max_date }
            : {},
          loading: false,
        }));
      } catch {
        setState(prev => ({ ...prev, loading: false }));
      }
    }
    loadOptions();
  }, []);

  const setDateRange = useCallback((dr: DateRangeFilter) => {
    setState(prev => ({ ...prev, dateRange: dr }));
  }, []);

  const setPreviousDateRange = useCallback((dr: DateRangeFilter | null) => {
    setState(prev => ({ ...prev, previousDateRange: dr }));
  }, []);

  const setFilters = useCallback((f: DimensionFilter) => {
    setState(prev => ({ ...prev, filters: f }));
  }, []);

  const updateFilter = useCallback(<K extends keyof DimensionFilter>(key: K, value: DimensionFilter[K]) => {
    setState(prev => ({ ...prev, filters: { ...prev.filters, [key]: value } }));
  }, []);

  const resetFilters = useCallback(() => {
    setState(prev => ({
      ...prev,
      filters: defaultFilters,
      dateRange: prev.dataDateRange
        ? { start_date: prev.dataDateRange.min_date, end_date: prev.dataDateRange.max_date }
        : {},
      previousDateRange: null,
    }));
  }, []);

  return (
    <FilterContext.Provider value={{ ...state, setDateRange, setPreviousDateRange, setFilters, updateFilter, resetFilters }}>
      {children}
    </FilterContext.Provider>
  );
}

export function useFilters() {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error('useFilters must be used within FilterProvider');
  return ctx;
}
