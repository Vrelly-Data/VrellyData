import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PersonEntity, CompanyEntity } from '@/types/audience';
import { ColumnConfig } from '@/types/tableColumns';

interface RecordsTableProps {
  records: (PersonEntity | CompanyEntity)[];
  columns: ColumnConfig<PersonEntity | CompanyEntity>[];
  selectedRecords: Set<string>;
  onSelectionChange: (selected: Set<string>) => void;
}

export function RecordsTable({ records, columns, selectedRecords, onSelectionChange }: RecordsTableProps) {
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

  const allSelected = records.length > 0 && selectedRecords.size === records.length;

  return (
    <ScrollArea className="flex-1">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">
              <Checkbox
                checked={allSelected}
                onCheckedChange={(v) => handleSelectAll(v === true)}
              />
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
