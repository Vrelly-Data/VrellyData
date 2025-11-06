import * as React from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PersonEntity, CompanyEntity } from '@/types/audience';
import { ColumnConfig } from '@/types/tableColumns';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface RecordsTableProps {
  records: (PersonEntity | CompanyEntity)[];
  columns: ColumnConfig<PersonEntity | CompanyEntity>[];
  selectedRecords: Set<string>;
  onSelectionChange: (selected: Set<string>) => void;
}

export function RecordsTable({ records, columns, selectedRecords, onSelectionChange }: RecordsTableProps) {
  const [selectCount, setSelectCount] = React.useState<string>('');
  const [selectPerCompanyCount, setSelectPerCompanyCount] = React.useState<string>('');

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      onSelectionChange(new Set(records.map(r => r.id)));
    } else {
      onSelectionChange(new Set());
    }
  };

  const handleSelectOne = (id: string, checked: boolean) => {
    const newSelected = new Set(selectedRecords);
    if (checked) {
      newSelected.add(id);
    } else {
      newSelected.delete(id);
    }
    onSelectionChange(newSelected);
  };

  const handleSelectNumber = (count: number) => {
    const selectedIds = records.slice(0, count).map(r => r.id);
    onSelectionChange(new Set(selectedIds));
  };

  const handleCustomSelect = (value: string) => {
    const count = parseInt(value, 10);
    if (!isNaN(count) && count > 0) {
      const validCount = Math.min(count, records.length);
      handleSelectNumber(validCount);
      setSelectCount('');
    }
  };

  const handleSelectPerCompany = (countPerCompany: number) => {
    // Only works for PersonEntity records (companies have company field)
    const peopleRecords = records.filter(r => 'company' in r) as PersonEntity[];
    
    // Group by company
    const companiesMap = new Map<string, PersonEntity[]>();
    
    peopleRecords.forEach(person => {
      const companyName = person.company?.trim().toLowerCase() || 'no-company';
      if (!companiesMap.has(companyName)) {
        companiesMap.set(companyName, []);
      }
      companiesMap.get(companyName)!.push(person);
    });
    
    // Select X people from each company
    const selectedIds: string[] = [];
    companiesMap.forEach((people) => {
      const toSelect = people.slice(0, countPerCompany);
      selectedIds.push(...toSelect.map(p => p.id));
    });
    
    onSelectionChange(new Set(selectedIds));
  };

  const handleCustomPerCompanySelect = (value: string) => {
    const count = parseInt(value, 10);
    if (!isNaN(count) && count > 0) {
      handleSelectPerCompany(count);
      setSelectPerCompanyCount('');
    }
  };

  const allSelected = records.length > 0 && selectedRecords.size === records.length;

  return (
    <ScrollArea className="flex-1">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12 pl-3">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 -ml-1">
                    <Checkbox
                      checked={allSelected}
                      className="pointer-events-none"
                    />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => handleSelectAll(true)}>
                    Select All ({records.length})
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <div className="px-2 py-2">
                    <label className="text-sm font-medium mb-1.5 block">Select first:</label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min="1"
                        max={records.length}
                        value={selectCount}
                        onChange={(e) => setSelectCount(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleCustomSelect(selectCount);
                          }
                        }}
                        placeholder={`1-${records.length}`}
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
                  <div className="px-2 py-2">
                    <label className="text-sm font-medium mb-1.5 block">Select per company:</label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min="1"
                        value={selectPerCompanyCount}
                        onChange={(e) => setSelectPerCompanyCount(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleCustomPerCompanySelect(selectPerCompanyCount);
                          }
                        }}
                        placeholder="1, 2, 3..."
                        className="h-8 w-24"
                      />
                      <Button 
                        size="sm" 
                        onClick={() => handleCustomPerCompanySelect(selectPerCompanyCount)}
                        disabled={!selectPerCompanyCount}
                      >
                        Select
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Select X people from each company
                    </p>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => handleSelectAll(false)}>
                    Deselect All
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </TableHead>
            {columns.map((column) => (
              <TableHead key={column.id} className={column.width}>
                {column.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {columns.length === 0 ? (
            <TableRow>
              <TableCell colSpan={1} className="text-center text-muted-foreground py-8">
                No columns selected. Use the "Columns" button to add some.
              </TableCell>
            </TableRow>
          ) : (
            records.map((record) => (
              <TableRow key={record.id}>
                <TableCell>
                  <Checkbox
                    checked={selectedRecords.has(record.id)}
                    onCheckedChange={(v) => handleSelectOne(record.id, v === true)}
                  />
                </TableCell>
                {columns.map((column) => (
                  <TableCell key={column.id} className={column.id === 'name' ? 'font-medium' : ''}>
                    {column.renderCell 
                      ? column.renderCell(record[column.field], record)
                      : String(record[column.field] || '-')
                    }
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}
