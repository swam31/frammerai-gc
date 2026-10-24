'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Search, Download, X, ExternalLink, CheckCircle, XCircle } from 'lucide-react';
import DataTable from '@/components/ui/DataTable';
import ChartCard from '@/components/ui/ChartCard';
import KpiCard from '@/components/ui/KpiCard';
import { useFilters } from '@/lib/filters-context';
import { videoApi, VideoDetail, PaginatedVideos, BulkStats } from '@/lib/api';
import { formatNumber } from '@/lib/chart-utils';

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function VideoExplorerPage() {
  const { dateRange, filters, loading: fl } = useFilters();
  const [searchQuery, setSearchQuery] = useState('');
  const [publishedOnly, setPublishedOnly] = useState<boolean | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [data, setData] = useState<PaginatedVideos | null>(null);
  const [stats, setStats] = useState<BulkStats | null>(null);
  const [selectedVideo, setSelectedVideo] = useState<VideoDetail | null>(null);
  const [detailData, setDetailData] = useState<VideoDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const buildReq = useCallback(() => ({
    date_range: dateRange,
    filters,
    search_query: searchQuery || null,
    published_only: publishedOnly,
    pagination: { page, page_size: pageSize },
    sort_by: null,
    sort_order: 'desc' as const,
  }), [dateRange, filters, searchQuery, publishedOnly, page, pageSize]);

  const fetchData = useCallback(async () => {
    if (fl) return;
    setLoading(true);
    try {
      const req = buildReq();
      const [videos, bulkStats] = await Promise.all([
        videoApi.search(req).catch(() => null),
        videoApi.stats(req).catch(() => null),
      ]);
      setData(videos as PaginatedVideos | null);
      setStats(bulkStats as BulkStats | null);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [fl, buildReq]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!selectedVideo) { setDetailData(null); return; }
    videoApi.detail(selectedVideo.input_video_id)
      .then(details => setDetailData((details[0] ?? selectedVideo) as VideoDetail))
      .catch(() => setDetailData(selectedVideo));
  }, [selectedVideo]);

  const handleExport = async () => {
    try {
      const req = { ...buildReq(), pagination: { page: 1, page_size: 10000 } };
      const rows = await videoApi.exportCsv(req);
      const headers = ['headline', 'channel_name', 'client_name', 'user_name', 'team_name', 'language', 'input_type', 'output_type', 'upload_date', 'is_published', 'published_platform', 'published_url'];
      const csv = [
        headers.join(','),
        ...(rows as VideoDetail[]).map(r =>
          headers.map(h => `"${String((r as any)[h] ?? '').replace(/"/g, '""')}"`).join(',')
        ),
      ].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'frammer_videos_export.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { console.error(e); }
  };

  const isLoading = loading || fl;

  return (
    <div className="page-container">
      {/* ─── Header ─── */}
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title">Video Explorer</h1>
          <p className="page-subtitle">
            Search, filter, and inspect individual videos across the entire pipeline. Click any row to see full lifecycle details including source, processing, and publish status.
          </p>
        </div>
        <button className="btn-primary" onClick={handleExport} style={{ marginTop: 8 }}>
          <Download size={14} /> Export CSV
        </button>
      </div>

      {/* ─── Bulk Stats ─── */}
      <div className="grid-4 section-gap">
        <KpiCard title="Total Videos" value={stats?.total_videos ?? 0} description="Total number of videos matching current filters" loading={isLoading} />
        <KpiCard title="Total Duration" value={stats?.total_duration_hours ?? 0} suffix="hrs" description="Combined duration of all matched videos" loading={isLoading} />
        <KpiCard title="Published Videos" value={stats?.published_count ?? 0} description="Videos that have been published to at least one platform" loading={isLoading} />
        <KpiCard title="Publish Rate" value={stats?.publish_rate_pct ?? 0} suffix="%" description="Percentage of matched videos that are published" loading={isLoading} />
      </div>

      {/* ─── Search + Filter ─── */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 28, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            className="input-field"
            placeholder="Search by headline, source, or channel name..."
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setPage(1); }}
            style={{ paddingLeft: 40 }}
          />
        </div>
        <div className="tab-group">
          <button className={`tab-item ${publishedOnly === null ? 'active' : ''}`} onClick={() => { setPublishedOnly(null); setPage(1); }}>All Videos</button>
          <button className={`tab-item ${publishedOnly === true ? 'active' : ''}`} onClick={() => { setPublishedOnly(true); setPage(1); }}>Published</button>
          <button className={`tab-item ${publishedOnly === false ? 'active' : ''}`} onClick={() => { setPublishedOnly(false); setPage(1); }}>Unpublished</button>
        </div>
      </div>

      {/* ─── Table ─── */}
      <ChartCard title="Video Results" description="Click any row to view full details in the side panel. Sort by clicking column headers." loading={isLoading} minHeight={300}>
        <DataTable
          columns={[
            { key: 'headline', label: 'Headline', sortable: true, width: '22%', render: (r: any) => (
              <span style={{ fontWeight: 500, fontSize: '0.82rem' }}>{String(r.headline).slice(0, 55)}{String(r.headline).length > 55 ? '...' : ''}</span>
            )},
            { key: 'channel_name', label: 'Channel', sortable: true },
            { key: 'client_name', label: 'Client', sortable: true },
            { key: 'user_name', label: 'User', sortable: true },
            { key: 'language', label: 'Language', sortable: true },
            { key: 'output_type', label: 'Type', sortable: true },
            { key: 'upload_date', label: 'Uploaded', sortable: true, render: (r: any) => r.upload_date || '—' },
            { key: 'is_published', label: 'Status', sortable: true, align: 'center', render: (r: any) => (
              r.is_published
                ? <span className="badge badge-success"><CheckCircle size={10} /> Published</span>
                : <span className="badge badge-neutral"><XCircle size={10} /> Draft</span>
            )},
          ]}
          data={data?.items as any[] ?? []}
          onRowClick={(r) => setSelectedVideo(r as unknown as VideoDetail)}
          emptyMessage="No videos found matching your search and filter criteria."
        />
        {data && data.total_pages > 1 && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 20px', borderTop: '1px solid var(--border-subtle)', fontSize: '0.82rem', color: 'var(--text-secondary)',
          }}>
            <span>Showing page {data.page} of {data.total_pages} ({formatNumber(data.total)} videos total)</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-ghost" style={{ padding: '6px 16px' }} disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</button>
              <button className="btn-ghost" style={{ padding: '6px 16px' }} disabled={page >= data.total_pages} onClick={() => setPage(p => p + 1)}>Next</button>
            </div>
          </div>
        )}
      </ChartCard>

      {/* ─── Detail Drawer ─── */}
      {selectedVideo && (
        <>
          <div
            onClick={() => setSelectedVideo(null)}
            style={{
              position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
              background: 'var(--overlay)', zIndex: 99,
            }}
          />
          <div
            style={{
              position: 'fixed', top: 0, right: 0, bottom: 0, width: 480,
              background: 'var(--bg-surface-solid)', borderLeft: '1px solid var(--border-default)',
              zIndex: 100, display: 'flex', flexDirection: 'column',
              animation: 'slideInRight 0.3s ease-out',
              boxShadow: 'var(--shadow-xl)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid var(--border-subtle)' }}>
              <h3 className="section-title">Video Details</h3>
              <button onClick={() => setSelectedVideo(null)} className="btn-icon"><X size={16} /></button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
              {(() => {
                const v = detailData || selectedVideo;
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ marginBottom: 16 }}>
                      <span className="label">Headline</span>
                      <p style={{ fontWeight: 500, marginTop: 6, fontSize: '1rem', lineHeight: 1.5 }}>{v.headline}</p>
                    </div>
                    {[
                      ['Channel', v.channel_name],
                      ['Client', v.client_name],
                      ['User', v.user_name],
                      ['Team', v.team_name],
                      ['Language', v.language],
                      ['Input Type', v.input_type],
                      ['Output Type', v.output_type],
                      ['Upload Date', v.upload_date],
                      ['Duration', v.uploaded_duration_seconds ? `${(Number(v.uploaded_duration_seconds) / 3600).toFixed(2)} hours` : '—'],
                    ].map(([label, val]) => (
                      <div key={String(label)} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{label}</span>
                        <span style={{ fontSize: '0.85rem', fontWeight: 500, textAlign: 'right', maxWidth: '55%' }}>{String(val || '—')}</span>
                      </div>
                    ))}
                    <div style={{ marginTop: 16, marginBottom: 8 }}>
                      <span className="label">Publish Status</span>
                      <div style={{ marginTop: 10 }}>
                        {v.is_published
                          ? <span className="badge badge-success"><CheckCircle size={10} /> Published</span>
                          : <span className="badge badge-neutral"><XCircle size={10} /> Not Published</span>
                        }
                      </div>
                    </div>
                    {v.published_platform && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Platform</span>
                        <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>{v.published_platform}</span>
                      </div>
                    )}
                    {v.published_url && (
                      <a
                        href={v.published_url} target="_blank" rel="noopener noreferrer"
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 16,
                          color: 'var(--accent-bright)', fontSize: '0.85rem', fontWeight: 500,
                          textDecoration: 'none',
                        }}
                      >
                        <ExternalLink size={13} /> View Published Video
                      </a>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
