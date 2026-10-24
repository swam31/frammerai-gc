'use client';

import React, { useState } from 'react';
import { useFilters } from '@/lib/filters-context';
import type { FilterOption } from '@/lib/filters-context';
import {
  Calendar, Building2, Monitor, Users,
  Languages, FileType, ChevronDown, ChevronUp,
  RotateCcw, SlidersHorizontal, X,Search
} from 'lucide-react';

interface MultiSelectProps {
  label: string;
  icon: React.ReactNode;
  options: FilterOption[];
  selected: string[] | null | undefined;
  onChange: (val: string[] | null) => void;
}

// function MultiSelect({ label, icon, options, selected, onChange }: MultiSelectProps) {
//   const [open, setOpen] = useState(false);
//   const selectedSet = new Set(selected || []);

//   const toggle = (id: number) => {
//     const value = String(id);
//     const next = new Set(selectedSet);
//     if (next.has(value)) next.delete(value);
//     else next.add(value);
//     onChange(next.size > 0 ? Array.from(next) : null);
//   };

//   return (
//     <div style={{ position: 'relative', minWidth: 170 }}>
//       <button
//         onClick={() => setOpen(!open)}
//         className="input-field"
//         style={{
//           display: 'flex',
//           alignItems: 'center',
//           gap: 8,
//           cursor: 'pointer',
//           fontSize: '0.82rem',
//           padding: '9px 14px',
//           whiteSpace: 'nowrap',
//         }}
//       >
//         {icon}
//         <span style={{ color: selectedSet.size > 0 ? 'var(--text-primary)' : 'var(--text-muted)', flex: 1, textAlign: 'left' }}>
//           {selectedSet.size > 0 ? `${label} (${selectedSet.size})` : label}
//         </span>
//         {selectedSet.size > 0 ? (
//           <X
//             size={12}
//             style={{ cursor: 'pointer' }}
//             onClick={(e) => { e.stopPropagation(); onChange(null); }}
//           />
//         ) : (
//           open ? <ChevronUp size={12} /> : <ChevronDown size={12} />
//         )}
//       </button>
//       {open && (
//         <>
//           <div
//             style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 98 }}
//             onClick={() => setOpen(false)}
//           />
//           <div
//             style={{
//               position: 'absolute',
//               top: '100%',
//               left: 0,
//               minWidth: '100%',
//               marginTop: 6,
//               background: 'var(--bg-surface-solid)',
//               border: '1px solid var(--border-default)',
//               borderRadius: 'var(--radius-md)',
//               maxHeight: 220,
//               overflowY: 'auto',
//               zIndex: 100,
//               boxShadow: 'var(--shadow-lg)',
//             }}
//           >
//             {options.map(opt => {
//               const optionId = String(opt.id);
//               return (
//               <label
//                 key={optionId}
//                 style={{
//                   display: 'flex',
//                   alignItems: 'center',
//                   gap: 10,
//                   padding: '10px 14px',
//                   fontSize: '0.82rem',
//                   cursor: 'pointer',
//                   color: selectedSet.has(optionId) ? 'var(--text-primary)' : 'var(--text-secondary)',
//                   transition: 'background var(--transition-fast)',
//                 }}
//                 onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent-muted)')}
//                 onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
//               >
//                 <input
//                   type="checkbox"
//                   checked={selectedSet.has(optionId)}
//                   onChange={() => toggle(opt.id)}
//                   style={{ accentColor: 'var(--accent)', width: 15, height: 15 }}
//                 />
//                 <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
//                   {opt.name}
//                 </span>
//               </label>
//               );
//             })}
//             {options.length === 0 && (
//               <div style={{
//                 padding: '16px',
//                 color: 'var(--text-muted)',
//                 fontSize: '0.82rem',
//                 textAlign: 'center',
//               }}>
//                 No options available
//               </div>
//             )}
//           </div>
//         </>
//       )}
//     </div>
//   );
// }

function MultiSelect({ label, icon, options, selected, onChange }: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState(''); // State for the search bar
  
  const selectedSet = new Set(selected || []);

  const toggle = (id: number) => {
    const value = String(id);
    const next = new Set(selectedSet);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next.size > 0 ? Array.from(next) : null);
  };

  // Filter options based on search query (case-insensitive)
  const filteredOptions = options.filter(opt =>
    opt.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Clear search query when dropdown closes
  const handleClose = () => {
    setOpen(false);
    setTimeout(() => setSearchQuery(''), 200); // Small delay to prevent visual jump while animating out
  };

  return (
    <div style={{ position: 'relative', minWidth: 170 }}>
      {/* Trigger Button */}
      <button
        onClick={() => setOpen(!open)}
        className="input-field"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: 'pointer',
          fontSize: '0.82rem',
          padding: '9px 14px',
          whiteSpace: 'nowrap',
        }}
      >
        {icon}
        <span style={{ color: selectedSet.size > 0 ? 'var(--text-primary)' : 'var(--text-muted)', flex: 1, textAlign: 'left' }}>
          {selectedSet.size > 0 ? `${label} (${selectedSet.size})` : label}
        </span>
        {selectedSet.size > 0 ? (
          <X
            size={12}
            style={{ cursor: 'pointer' }}
            onClick={(e) => { e.stopPropagation(); onChange(null); }}
          />
        ) : (
          open ? <ChevronUp size={12} /> : <ChevronDown size={12} />
        )}
      </button>

      {/* Dropdown Menu */}
      {open && (
        <>
          {/* Overlay to close on outside click */}
          <div
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000 }}
            onClick={handleClose}
          />
          
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              minWidth: '100%',
              marginTop: 6,
              background: 'var(--bg-surface-solid)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              zIndex: 1000,
              boxShadow: 'var(--shadow-lg)',
              overflow: 'hidden', // Prevents search bar from breaking border radius
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Search Bar Container */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 14px',
              borderBottom: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface)',
            }}>
              <Search size={14} style={{ color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder={`Search ${label}...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus // Automatically focuses the input when dropdown opens
                style={{
                  border: 'none',
                  background: 'transparent',
                  outline: 'none',
                  width: '100%',
                  fontSize: '0.82rem',
                  color: 'var(--text-primary)',
                }}
              />
            </div>

            {/* Scrollable Options List */}
            <div style={{
              maxHeight: 220,
              overflowY: 'auto',
            }}>
              {filteredOptions.map(opt => {
                const optionId = String(opt.id);
                return (
                  <label
                    key={optionId}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '10px 14px',
                      fontSize: '0.82rem',
                      cursor: 'pointer',
                      color: selectedSet.has(optionId) ? 'var(--text-primary)' : 'var(--text-secondary)',
                      transition: 'background var(--transition-fast)',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent-muted)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <input
                      type="checkbox"
                      checked={selectedSet.has(optionId)}
                      onChange={() => toggle(opt.id)}
                      style={{ accentColor: 'var(--accent)', width: 15, height: 15 }}
                    />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {opt.name}
                    </span>
                  </label>
                );
              })}
              
              {/* Empty State */}
              {filteredOptions.length === 0 && (
                <div style={{
                  padding: '16px',
                  color: 'var(--text-muted)',
                  fontSize: '0.82rem',
                  textAlign: 'center',
                }}>
                  No results found
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function FilterBar() {
  const {
    dateRange, setDateRange, filters, updateFilter,
    resetFilters, companies, channels, users, teams,
    languages, inputTypes, outputTypes, loading,
  } = useFilters();

  const [expanded, setExpanded] = useState(false);

  if (loading) return null;

  const hasActive = Object.values(filters).some(
    v => v !== null && v !== undefined && (Array.isArray(v) ? v.length > 0 : true)
  );

  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 40,
        background: 'var(--bg-surface)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      {/* Toggle Row */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 28px',
      }}>
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'transparent',
            border: 'none',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: '0.82rem',
            fontWeight: 500,
            fontFamily: 'var(--font-body)',
          }}
        >
          <SlidersHorizontal size={14} />
          <span>Filters & Date Range</span>
          {hasActive && (
            <span className="badge badge-danger" style={{ fontSize: '0.62rem', padding: '2px 8px' }}>
              Active
            </span>
          )}
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>

        {/* Date pickers always visible */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Calendar size={14} style={{ color: 'var(--text-muted)' }} />
          <input
            type="date"
            className="input-field"
            style={{ width: 145, fontSize: '0.82rem', padding: '7px 12px' }}
            value={dateRange.start_date || ''}
            onChange={e => setDateRange({ ...dateRange, start_date: e.target.value || null })}
          />
          <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>to</span>
          <input
            type="date"
            className="input-field"
            style={{ width: 145, fontSize: '0.82rem', padding: '7px 12px' }}
            value={dateRange.end_date || ''}
            onChange={e => setDateRange({ ...dateRange, end_date: e.target.value || null })}
          />
          {hasActive && (
            <button onClick={resetFilters} className="btn-ghost" style={{ padding: '7px 14px', fontSize: '0.78rem' }}>
              <RotateCcw size={12} /> Reset All
            </button>
          )}
        </div>
      </div>

      {/* Expanded Filters */}
      {expanded && (
        <div style={{
          padding: '0 28px 16px',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          animation: 'fadeInUp 0.25s ease-out',
        }}>
          <MultiSelect label="Company" icon={<Building2 size={13} />} options={companies} selected={filters.client_ids} onChange={v => updateFilter('client_ids', v)} />
          <MultiSelect label="Channel" icon={<Monitor size={13} />} options={channels} selected={filters.channel_ids} onChange={v => updateFilter('channel_ids', v)} />
          <MultiSelect label="User" icon={<Users size={13} />} options={users} selected={filters.user_ids} onChange={v => updateFilter('user_ids', v)} />
          <MultiSelect label="Team" icon={<Users size={13} />} options={teams} selected={filters.team_ids} onChange={v => updateFilter('team_ids', v)} />
          <MultiSelect label="Language" icon={<Languages size={13} />} options={languages} selected={filters.language_ids} onChange={v => updateFilter('language_ids', v)} />
          <MultiSelect label="Input Type" icon={<FileType size={13} />} options={inputTypes} selected={filters.input_type_ids} onChange={v => updateFilter('input_type_ids', v)} />
          <MultiSelect label="Output Type" icon={<FileType size={13} />} options={outputTypes} selected={filters.output_type_ids} onChange={v => updateFilter('output_type_ids', v)} />
        </div>
      )}
    </div>
  );
}
