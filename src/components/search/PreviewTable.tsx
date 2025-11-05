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

interface PreviewTableProps {
  data: (PersonEntity | CompanyEntity)[];
  entityType: 'person' | 'company';
  isUnlocked: (id: string) => boolean;
  selectedRecords: Set<string>;
  onSelectionChange: (selected: Set<string>) => void;
}

export function PreviewTable({ data, entityType, isUnlocked, selectedRecords, onSelectionChange }: PreviewTableProps) {
  const [selectCount, setSelectCount] = useState<string>('');

  const handleSelectAll = () => {
    const newSelected = new Set(data.map(r => r.id));
    onSelectionChange(newSelected);
  };

  const handleSelectNumber = (count: number) => {
    const newSelected = new Set(data.slice(0, count).map(r => r.id));
    onSelectionChange(newSelected);
  };

  const handleCustomSelect = (value: string) => {
    const count = parseInt(value, 10);
    if (!isNaN(count) && count > 0) {
      const validCount = Math.min(count, data.length);
      handleSelectNumber(validCount);
      setSelectCount('');
    }
  };

  const handleDeselectAll = () => {
    onSelectionChange(new Set());
  };

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
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={handleSelectAll}>
                      Select All ({data.length})
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <div className="px-2 py-2">
                      <label className="text-sm font-medium mb-1.5 block">Select first:</label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min="1"
                          max={data.length}
                          value={selectCount}
                          onChange={(e) => setSelectCount(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleCustomSelect(selectCount);
                            }
                          }}
                          placeholder={`1-${data.length}`}
                          className="h-8 w-24"
                        />
                        <Button 
                          size="sm" 
                          onClick={() => handleCustomSelect(selectCount)}
                          disabled={!selectCount}
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
                  <Checkbox
                    checked={selectedRecords.has(person.id)}
                    onCheckedChange={() => handleToggleRow(person.id)}
                  />
                </TableCell>
                <TableCell className="sticky left-[50px] bg-background font-medium">{person.name}</TableCell>
                <TableCell>{person.title || 'N/A'}</TableCell>
                <TableCell>
                  <BlurredField value={person.email || 'N/A'} isUnlocked={isUnlocked(person.id)} />
                </TableCell>
                <TableCell>
                  <BlurredField value={person.linkedin || 'N/A'} isUnlocked={isUnlocked(person.id)} />
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
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={handleSelectAll}>
                    Select All ({data.length})
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <div className="px-2 py-2">
                    <label className="text-sm font-medium mb-1.5 block">Select first:</label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min="1"
                        max={data.length}
                        value={selectCount}
                        onChange={(e) => setSelectCount(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleCustomSelect(selectCount);
                          }
                        }}
                        placeholder={`1-${data.length}`}
                        className="h-8 w-24"
                      />
                      <Button 
                        size="sm" 
                        onClick={() => handleCustomSelect(selectCount)}
                        disabled={!selectCount}
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
                <Checkbox
                  checked={selectedRecords.has(company.id)}
                  onCheckedChange={() => handleToggleRow(company.id)}
                />
              </TableCell>
              <TableCell className="sticky left-[50px] bg-background font-medium">{company.name}</TableCell>
              <TableCell>{company.industry || 'N/A'}</TableCell>
              <TableCell>{company.domain || 'N/A'}</TableCell>
              <TableCell>{company.employeeCount || 'N/A'}</TableCell>
              <TableCell className="max-w-[300px] truncate">{company.description || 'N/A'}</TableCell>
              <TableCell>{company.location || 'N/A'}</TableCell>
              <TableCell>
                <BlurredField value={company.linkedin || 'N/A'} isUnlocked={isUnlocked(company.id)} />
              </TableCell>
              <TableCell>
                {company.phone ? (
                  <BlurredField value={company.phone} isUnlocked={isUnlocked(company.id)} />
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
