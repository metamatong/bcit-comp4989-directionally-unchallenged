import { useRef, useState } from 'react';
import { ArrowUpRight, FileText, Layers, Search, ShieldCheck } from 'lucide-react';
import { request, RequestGate } from '../api';
import type { Bootstrap, CatalogueRecord } from '../types';

type SourceResult = Partial<CatalogueRecord> & { excerpt?: string };
export function CampusLibrary({
  data,
  onError,
}: {
  data: Bootstrap;
  onError: (message: string) => void;
}) {
  const [libraryQuery, setLibraryQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SourceResult[] | null>(null);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const searchGate = useRef(new RequestGate());
  const plans = data.visualPlans;
  const catalogue: SourceResult[] =
    searchResults ??
    data.catalogue.filter(
      (record) => !libraryQuery || record.title.toLowerCase().includes(libraryQuery.toLowerCase()),
    );
  async function searchLibrary() {
    const generation = searchGate.current.next();
    setLibraryBusy(true);
    try {
      const records = await request<SourceResult[]>(
        `/api/search?q=${encodeURIComponent(libraryQuery)}`,
      );
      if (searchGate.current.isCurrent(generation)) setSearchResults(records);
    } catch (error) {
      if (searchGate.current.isCurrent(generation)) onError((error as Error).message);
    } finally {
      if (searchGate.current.isCurrent(generation)) setLibraryBusy(false);
    }
  }
  return (
    <section className="library-section">
      <div className="library-summary">
        <div>
          <FileText size={22} />
          <strong>{data.coverage.floorPlans}</strong>
          <span>official floor plans</span>
        </div>
        <div>
          <Layers size={22} />
          <strong>{data.coverage.buildings.length}</strong>
          <span>Burnaby buildings</span>
        </div>
        <div className="library-note">
          <ShieldCheck size={22} />
          <p>Source documents are preserved. Extracted labels need review before routing.</p>
        </div>
      </div>
      <form
        className="library-search"
        onSubmit={(e) => {
          e.preventDefault();
          void searchLibrary();
        }}
      >
        <Search size={20} />
        <input
          aria-label="Search official campus plans"
          placeholder="Search a building, room label, or source text…"
          value={libraryQuery}
          onChange={(e) => {
            setLibraryQuery(e.target.value);
            setSearchResults(null);
            searchGate.current.cancel();
            setLibraryBusy(false);
          }}
        />
        <button className="primary" disabled={libraryBusy}>
          {libraryBusy ? 'Searching…' : 'Search source text'}
        </button>
      </form>
      <div className="section-heading">
        <h2>{searchResults ? 'Source text results' : 'Burnaby floor-plan collection'}</h2>
        <span>{catalogue.length} documents</span>
      </div>
      <div className="library-grid">
        {catalogue.map((record) => (
          <article className="source-card" key={record.id}>
            <span className="source-icon">
              <FileText size={26} />
            </span>
            <div>
              <p className="eyebrow">
                {record.kind === 'campus-map' ? 'CAMPUS OVERVIEW' : 'OFFICIAL BCIT PDF'}
              </p>
              <h3>{record.title}</h3>
              <p>{record.labelCount ?? '—'} extracted label candidates</p>
            </div>
            {record.excerpt && <p className="source-excerpt">{record.excerpt}</p>}
            <div className="source-card-footer">
              <a href={record.localUrl} target="_blank" rel="noreferrer">
                View downloaded PDF <ArrowUpRight size={15} />
              </a>
              <a
                href={record.url}
                target="_blank"
                rel="noreferrer"
                aria-label={`Original BCIT source for ${record.title}`}
              >
                Source
              </a>
            </div>
            {plans.find((plan) => plan.sourceId === record.id) && (
              <div className="plan-source-links">
                <a
                  href={plans.find((plan) => plan.sourceId === record.id)!.full.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  View PNG
                  <ArrowUpRight size={14} />
                </a>
                <a
                  href={plans.find((plan) => plan.sourceId === record.id)!.geometry.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Geometry JSON
                  <ArrowUpRight size={14} />
                </a>
              </div>
            )}
          </article>
        ))}
      </div>
      {!catalogue.length && (
        <div className="empty-state">
          <Search size={30} />
          <h3>No matching plan found</h3>
          <p>Try a building code such as SE12 or SW1. Source text may be incomplete.</p>
        </div>
      )}
      <p className="source-attribution">
        © British Columbia Institute of Technology. Informational, non-commercial copies. No
        alterations to source PDFs. BCIT does not warrant the accuracy or completeness of floor
        plans.{' '}
        <a href="https://www.bcit.ca/copyright/" target="_blank" rel="noreferrer">
          Usage terms
        </a>{' '}
        · Retrieved October 15, 2026.
      </p>
    </section>
  );
}
