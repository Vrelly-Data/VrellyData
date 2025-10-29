import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PersonEntity, CompanyEntity, EntityType } from '@/types/audience';

interface RecordsTableProps {
  records: (PersonEntity | CompanyEntity)[];
  entityType: EntityType;
  selectedRecords: Set<string>;
  onSelectionChange: (selected: Set<string>) => void;
}

export function RecordsTable({ records, entityType, selectedRecords, onSelectionChange }: RecordsTableProps) {
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
                onCheckedChange={handleSelectAll}
              />
            </TableHead>
            {entityType === 'person' ? (
              <>
                <TableHead>Name</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Email</TableHead>
              </>
            ) : (
              <>
                <TableHead>Company</TableHead>
                <TableHead>Industry</TableHead>
                <TableHead>Employees</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Domain</TableHead>
              </>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((record) => (
            <TableRow key={record.id}>
              <TableCell>
                <Checkbox
                  checked={selectedRecords.has(record.id)}
                  onCheckedChange={(checked) => handleSelectOne(record.id, checked as boolean)}
                />
              </TableCell>
              {entityType === 'person' ? (
                <>
                  <TableCell className="font-medium">{(record as PersonEntity).name}</TableCell>
                  <TableCell>{(record as PersonEntity).jobTitle || (record as PersonEntity).title}</TableCell>
                  <TableCell>{(record as PersonEntity).company}</TableCell>
                  <TableCell>{(record as PersonEntity).city || (record as PersonEntity).location}</TableCell>
                  <TableCell>{(record as PersonEntity).email || '-'}</TableCell>
                </>
              ) : (
                <>
                  <TableCell className="font-medium">{(record as CompanyEntity).name}</TableCell>
                  <TableCell>{(record as CompanyEntity).industry}</TableCell>
                  <TableCell>{(record as CompanyEntity).employeeCount?.toLocaleString()}</TableCell>
                  <TableCell>{(record as CompanyEntity).location}</TableCell>
                  <TableCell>{(record as CompanyEntity).domain}</TableCell>
                </>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}
