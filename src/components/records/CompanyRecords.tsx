import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, Download } from 'lucide-react';
import { generateMockCompanies } from '@/lib/mockData';
import { CompanyEntity } from '@/types/audience';
import { RecordsTable } from './RecordsTable';
import { RecordsFilters } from './RecordsFilters';

export function CompanyRecords() {
  const [records] = useState<CompanyEntity[]>(generateMockCompanies(100));
  const [selectedRecords, setSelectedRecords] = useState<Set<string>>(new Set());

  const handleExport = () => {
    console.log('Export selected records:', selectedRecords);
  };

  return (
    <div className="flex h-full">
      <RecordsFilters entityType="company" />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="border-b p-4 flex items-center justify-between bg-background">
          <h2 className="text-lg font-semibold">Company Records</h2>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-2" />
              New List
            </Button>
          </div>
        </div>
        
        <RecordsTable
          records={records}
          entityType="company"
          selectedRecords={selectedRecords}
          onSelectionChange={setSelectedRecords}
        />
      </div>
    </div>
  );
}
