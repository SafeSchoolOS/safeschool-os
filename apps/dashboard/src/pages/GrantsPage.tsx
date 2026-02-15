import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface Grant {
  id: string;
  name: string;
  source: string;
  description: string;
  amount: { min: number; max: number };
  eligibility: string[];
  deadline?: string;
  modules: string[];
  schoolTypes: string[];
  states?: string[];
  url?: string;
}

interface FundingEstimate {
  totalMin: number;
  totalMax: number;
  grants: Grant[];
}

interface BudgetItem {
  category: string;
  item: string;
  unitCost: number;
  quantity: number;
  total: number;
}

const AVAILABLE_MODULES = [
  'access-control', 'panic-button', '911-dispatch', 'visitor-mgmt',
  'cameras', 'transportation', 'threat-assessment', 'social-media',
  'environmental', 'notifications', 'drills',
];

const SOURCE_LABELS: Record<string, string> = {
  FEDERAL: 'Federal',
  STATE: 'State',
  PRIVATE: 'Private Foundation',
};

export function GrantsPage() {
  const { token } = useAuth();
  const [selectedModules, setSelectedModules] = useState<string[]>([]);
  const [filterSource, setFilterSource] = useState('');
  const [showBudget, setShowBudget] = useState(false);

  const modulesParam = selectedModules.join(',');

  const { data: searchResults, isLoading } = useQuery<{ grants: Grant[]; total: number }>({
    queryKey: ['grants-search', filterSource, modulesParam],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterSource) params.set('source', filterSource);
      if (modulesParam) params.set('modules', modulesParam);
      const res = await fetch(`${API_URL}/api/v1/grants/search?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Failed to search grants (${res.status})`);
      return res.json();
    },
  });

  const { data: estimate } = useQuery<FundingEstimate>({
    queryKey: ['grants-estimate', modulesParam],
    enabled: selectedModules.length > 0,
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/v1/grants/estimate?modules=${modulesParam}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Failed to estimate funding (${res.status})`);
      return res.json();
    },
  });

  const { data: budgetData } = useQuery<{ modules: string[]; budgetItems: BudgetItem[] }>({
    queryKey: ['grants-budget', modulesParam],
    enabled: showBudget && selectedModules.length > 0,
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/v1/grants/budget-template?modules=${modulesParam}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Failed to load budget template (${res.status})`);
      return res.json();
    },
  });

  const grants = searchResults?.grants || [];

  function toggleModule(mod: string) {
    setSelectedModules((prev) =>
      prev.includes(mod) ? prev.filter((m) => m !== mod) : [...prev, mod]
    );
  }

  function formatCurrency(n: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
  }

  return (
    <div className="p-3 sm:p-6">
      {/* Module Selector */}
      <div className="mb-6">
        <h2 className="text-sm font-medium text-gray-400 mb-2">Select modules to find matching grants:</h2>
        <div className="flex flex-wrap gap-2">
          {AVAILABLE_MODULES.map((mod) => (
            <button
              key={mod}
              onClick={() => toggleModule(mod)}
              className={`px-3 py-1.5 rounded text-sm transition-colors ${
                selectedModules.includes(mod)
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {mod.replace(/-/g, ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* Funding Estimate */}
      {estimate && selectedModules.length > 0 && (
        <div className="bg-gray-800 rounded-lg p-4 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-400">Estimated Available Funding</div>
              <div className="text-2xl font-bold text-green-400">
                {formatCurrency(estimate.totalMin)} - {formatCurrency(estimate.totalMax)}
              </div>
            </div>
            <button
              onClick={() => setShowBudget(!showBudget)}
              className="bg-gray-700 hover:bg-gray-600 px-4 py-1.5 rounded text-sm"
            >
              {showBudget ? 'Hide' : 'Show'} Budget Template
            </button>
          </div>
        </div>
      )}

      {/* Budget Template */}
      {showBudget && budgetData && (
        <div className="bg-gray-800 rounded-lg overflow-hidden mb-6">
          <div className="px-4 py-3 border-b border-gray-700">
            <h3 className="font-semibold">Budget Template</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400">
                <th className="text-left px-4 py-2">Category</th>
                <th className="text-left px-4 py-2">Item</th>
                <th className="text-right px-4 py-2">Unit Cost</th>
                <th className="text-right px-4 py-2">Qty</th>
                <th className="text-right px-4 py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {budgetData.budgetItems.map((item, i) => (
                <tr key={i} className="border-b border-gray-700/50">
                  <td className="px-4 py-2">{item.category}</td>
                  <td className="px-4 py-2">{item.item}</td>
                  <td className="px-4 py-2 text-right">{formatCurrency(item.unitCost)}</td>
                  <td className="px-4 py-2 text-right">{item.quantity}</td>
                  <td className="px-4 py-2 text-right font-medium">{formatCurrency(item.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-700/30">
                <td colSpan={4} className="px-4 py-2 font-bold text-right">Total</td>
                <td className="px-4 py-2 text-right font-bold text-green-400">
                  {formatCurrency(budgetData.budgetItems.reduce((sum, item) => sum + item.total, 0))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Source Filter */}
      <div className="mb-4">
        <select
          value={filterSource}
          onChange={(e) => setFilterSource(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm"
        >
          <option value="">All Sources</option>
          {Object.entries(SOURCE_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Grants List */}
      <div className="space-y-3">
        {grants.map((grant) => (
          <div key={grant.id} className="bg-gray-800 rounded-lg p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold">{grant.name}</h3>
                  <span className="bg-gray-700 px-2 py-0.5 rounded text-xs">{SOURCE_LABELS[grant.source] || grant.source}</span>
                </div>
                <p className="text-sm text-gray-400 mb-2">{grant.description}</p>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-green-400 font-medium">
                    {formatCurrency(grant.amount.min)} - {formatCurrency(grant.amount.max)}
                  </span>
                  {grant.deadline && (
                    <span className="text-gray-500">Deadline: {grant.deadline}</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {grant.modules.map((mod) => (
                    <span key={mod} className="bg-gray-700 px-2 py-0.5 rounded text-xs text-gray-300">
                      {mod.replace(/-/g, ' ')}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}
        {!isLoading && grants.length === 0 && (
          <div className="text-center text-gray-500 py-8">
            {selectedModules.length > 0 ? 'No grants found for selected modules.' : 'Select modules above to find matching grants.'}
          </div>
        )}
      </div>
    </div>
  );
}
