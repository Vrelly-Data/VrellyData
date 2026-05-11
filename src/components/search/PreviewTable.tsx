import { PersonEntity, CompanyEntity } from '@/types/audience';
import { BlurredField } from './BlurredField';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { TOTAL_DISPLAY_CAP } from '@/hooks/useFreeDataSearch';

interface PreviewTableProps {
  data: (PersonEntity | CompanyEntity)[];
  entityType: 'person' | 'company';
  isUnlocked: (entity: PersonEntity | CompanyEntity) => boolean;
  selectedRecords: Set<string>;
  onSelectionChange: (selected: Set<string>) => void;
  totalResults: number;
  onSelectAllResults?: () => void;
  onSelectFirstN?: (count: number) => Promise<void>;
  onSelectPerCompanyAcrossAudience?: (countPerCompany: number) => Promise<void>;
  onSelectStacked?: (people: number | null, maxPerCompany: number | null) => void | Promise<void>;
  onSelectPerCompanyOnSelection?: (maxPerCompany: number) => void;
}

export function PreviewTable({ data, entityType, isUnlocked, selectedRecords, onSelectionChange, totalResults, onSelectAllResults, onSelectFirstN, onSelectPerCompanyAcrossAudience, onSelectStacked, onSelectPerCompanyOnSelection }: PreviewTableProps) {
  const [selectCount, setSelectCount] = useState<string>('');
  const [selectPerCompanyCount, setSelectPerCompanyCount] = useState<string>('');

  const formatTotal = (n: number) =>
    n >= TOTAL_DISPLAY_CAP ? `${TOTAL_DISPLAY_CAP.toLocaleString()}+` : n.toLocaleString();

  const handleSelectAll = () => {
    const newSelected = new Set(data.map(r => r.id));
    onSelectionChange(newSelected);
  };

  const handleDeselectAll = () => {
    onSelectionChange(new Set());
  };

  const parsePositiveInt = (s: string): number | null => {
    const n = parseInt(s, 10);
    return !isNaN(n) && n > 0 ? n : null;
  };

  const handleFirstSelect = () => {
    const n = parsePositiveInt(selectCount);
    if (!n) return;
    onSelectStacked?.(n, null);
    setSelectCount('');
  };

  const handlePerCompanySelect = () => {
    const n = parsePositiveInt(selectPerCompanyCount);
    if (!n) return;
    // Natural stacking: if rows are already selected (e.g. user just
    // clicked Select first: 1000), dedup the selection in-memory.
    // Otherwise fall through to the full-audience per-company dedup.
    if (selectedRecords.size > 0 && onSelectPerCompanyOnSelection) {
      onSelectPerCompanyOnSelection(n);
    } else {
      onSelectStacked?.(null, n);
    }
    setSelectPerCompanyCount('');
  };

  const canSubmitFirst = !!parsePositiveInt(selectCount);
  const canSubmitPerCompany = !!parsePositiveInt(selectPerCompanyCount);

  const handleToggleRow = (id: string) => {
    const newSelected = new Set(selectedRecords);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    onSelectionChange(newSelected);
  };

  if (entityType === 'person') {
    const people = data as PersonEntity[];
    return (
      <ScrollArea className="flex-1 border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 bg-background z-10 w-[50px]">
                <div className="flex items-center pl-1.5">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                        <Checkbox
                          checked={selectedRecords.size > 0 && selectedRecords.size === data.length}
                          onCheckedChange={(checked) => {
                            if (checked) handleSelectAll();
                            else handleDeselectAll();
                          }}
                        />
                        <ChevronDown className="h-3 w-3 ml-1" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="bg-background">
                      <DropdownMenuItem onClick={handleSelectAll}>
                        Select All on Page ({data.length})
                      </DropdownMenuItem>
                      {totalResults > data.length && onSelectAllResults && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={onSelectAllResults}>
                            <div className="flex flex-col gap-1">
                             <span>Select All {formatTotal(totalResults)} Results</span>
                              <span className="text-xs text-muted-foreground">
                                May take a moment for large datasets
                              </span>
                            </div>
                          </DropdownMenuItem>
                        </>
                      )}
                      <DropdownMenuSeparator />
                      <div className="px-2 py-2">
                        <label className="text-sm font-medium mb-1.5 block">Select first:</label>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min="1"
                            max={totalResults}
                            value={selectCount}
                            onChange={(e) => setSelectCount(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleFirstSelect(); }}
                            placeholder={`1-${formatTotal(totalResults)}`}
                            className="h-8 w-24"
                          />
                          <Button
                            size="sm"
                            onClick={handleFirstSelect}
                            disabled={!canSubmitFirst}
                          >
                            Select
                          </Button>
                        </div>
                      </div>
                      <DropdownMenuSeparator />
                      <div className="px-2 py-2">
                        <label className="text-sm font-medium mb-1.5 block">Select per company:</label>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min="1"
                            value={selectPerCompanyCount}
                            onChange={(e) => setSelectPerCompanyCount(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handlePerCompanySelect(); }}
                            placeholder="1, 2, 3..."
                            className="h-8 w-24"
                          />
                          <Button
                            size="sm"
                            onClick={handlePerCompanySelect}
                            disabled={!canSubmitPerCompany}
                          >
                            Select
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          Select X people from each company
                        </p>
                      </div>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleDeselectAll}>
                      Deselect All
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                </div>
              </TableHead>
              <TableHead className="sticky left-[50px] bg-background z-10 min-w-[180px]">Name</TableHead>
              <TableHead className="min-w-[200px]">Title</TableHead>
              <TableHead className="min-w-[220px]">Email</TableHead>
              <TableHead className="min-w-[220px]">LinkedIn</TableHead>
              <TableHead className="min-w-[140px]">Seniority</TableHead>
              <TableHead className="min-w-[140px]">Department</TableHead>
              <TableHead className="min-w-[180px]">Company</TableHead>
              <TableHead className="min-w-[140px]">Company Size</TableHead>
              <TableHead className="min-w-[300px]">Company Description</TableHead>
              <TableHead className="min-w-[160px]">Industry</TableHead>
              <TableHead className="min-w-[180px]">Location</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {people.map((person) => (
              <TableRow key={person.id}>
                <TableCell className="sticky left-0 bg-background z-10">
                  <div className="flex items-center">
                    <Checkbox
                      checked={selectedRecords.has(person.id)}
                      onCheckedChange={() => handleToggleRow(person.id)}
                    />
                  </div>
                </TableCell>
                <TableCell className="sticky left-[50px] bg-background font-medium">{person.name}</TableCell>
                <TableCell>{person.jobTitle || 'N/A'}</TableCell>
                <TableCell>
                  <BlurredField value={person.email || 'N/A'} isUnlocked={isUnlocked(person)} />
                </TableCell>
                <TableCell>
                  <BlurredField value={person.linkedin || 'N/A'} isUnlocked={isUnlocked(person)} />
                </TableCell>
                <TableCell>{person.seniority || 'N/A'}</TableCell>
                <TableCell>{person.department || 'N/A'}</TableCell>
                <TableCell>{person.company || 'N/A'}</TableCell>
                <TableCell>{person.companySize || 'N/A'}</TableCell>
                <TableCell className="max-w-[300px] truncate">{person.companyDescription || 'N/A'}</TableCell>
                <TableCell>{person.industry || 'N/A'}</TableCell>
                <TableCell>{person.location || 'N/A'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    );
  }

  // Company entities
  const companies = data as CompanyEntity[];
  return (
    <ScrollArea className="flex-1 border rounded-lg">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 bg-background z-10 w-[50px]">
              <div className="flex items-center pl-1.5">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                      <Checkbox
                        checked={selectedRecords.size > 0 && selectedRecords.size === data.length}
                        onCheckedChange={(checked) => {
                          if (checked) handleSelectAll();
                          else handleDeselectAll();
                        }}
                      />
                      <ChevronDown className="h-3 w-3 ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="bg-background">
                    <DropdownMenuItem onClick={handleSelectAll}>
                      Select All on Page ({data.length})
                    </DropdownMenuItem>
                    {totalResults > data.length && onSelectAllResults && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={onSelectAllResults}>
                          <div className="flex flex-col gap-1">
                            <span>Select All {formatTotal(totalResults)} Results</span>
                            <span className="text-xs text-muted-foreground">
                              May take a moment for large datasets
                            </span>
                          </div>
                        </DropdownMenuItem>
                      </>
                    )}
                    <DropdownMenuSeparator />
                    <div className="px-2 py-2">
                      <label className="text-sm font-medium mb-1.5 block">Select first:</label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min="1"
                          max={totalResults}
                          value={selectCount}
                          onChange={(e) => setSelectCount(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleFirstSelect(); }}
                          placeholder={`1-${formatTotal(totalResults)}`}
                          className="h-8 w-24"
                        />
                        <Button
                          size="sm"
                          onClick={handleFirstSelect}
                          disabled={!canSubmitFirst}
                        >
                          Select
                        </Button>
                      </div>
                    </div>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleDeselectAll}>
                      Deselect All
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </TableHead>
            <TableHead className="sticky left-[50px] bg-background z-10 min-w-[180px]">Name</TableHead>
            <TableHead className="min-w-[160px]">Industry</TableHead>
            <TableHead className="min-w-[180px]">Domain</TableHead>
            <TableHead className="min-w-[120px]">Employees</TableHead>
            <TableHead className="min-w-[300px]">Description</TableHead>
            <TableHead className="min-w-[180px]">Location</TableHead>
            <TableHead className="min-w-[220px]">LinkedIn</TableHead>
            <TableHead className="min-w-[180px]">Phone</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {companies.map((company) => (
            <TableRow key={company.id}>
              <TableCell className="sticky left-0 bg-background z-10">
                <div className="flex items-center">
                  <Checkbox
                    checked={selectedRecords.has(company.id)}
                    onCheckedChange={() => handleToggleRow(company.id)}
                  />
                </div>
              </TableCell>
              <TableCell className="sticky left-[50px] bg-background font-medium">{company.name}</TableCell>
              <TableCell>{company.industry || 'N/A'}</TableCell>
              <TableCell>{company.domain || 'N/A'}</TableCell>
              <TableCell>{company.employeeCount || 'N/A'}</TableCell>
              <TableCell className="max-w-[300px] truncate">{company.description || 'N/A'}</TableCell>
              <TableCell>{company.location || 'N/A'}</TableCell>
              <TableCell>
                <BlurredField value={company.linkedin || 'N/A'} isUnlocked={isUnlocked(company)} />
              </TableCell>
              <TableCell>
                {company.phone ? (
                  <BlurredField value={company.phone} isUnlocked={isUnlocked(company)} />
                ) : (
                  'N/A'
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}
