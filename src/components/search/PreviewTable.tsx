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

interface PreviewTableProps {
  data: (PersonEntity | CompanyEntity)[];
  entityType: 'person' | 'company';
  isUnlocked: (id: string) => boolean;
}

export function PreviewTable({ data, entityType, isUnlocked }: PreviewTableProps) {
  if (entityType === 'person') {
    const people = data as PersonEntity[];
    return (
      <ScrollArea className="flex-1 border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 bg-background z-10 min-w-[180px]">Name</TableHead>
              <TableHead className="min-w-[200px]">Title</TableHead>
              <TableHead className="min-w-[220px]">Email</TableHead>
              <TableHead className="min-w-[220px]">LinkedIn</TableHead>
              <TableHead className="min-w-[140px]">Seniority</TableHead>
              <TableHead className="min-w-[140px]">Department</TableHead>
              <TableHead className="min-w-[180px]">Company</TableHead>
              <TableHead className="min-w-[140px]">Company Size</TableHead>
              <TableHead className="min-w-[160px]">Industry</TableHead>
              <TableHead className="min-w-[180px]">Location</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {people.map((person) => (
              <TableRow key={person.id}>
                <TableCell className="sticky left-0 bg-background font-medium">{person.name}</TableCell>
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
            <TableHead className="sticky left-0 bg-background z-10 min-w-[180px]">Name</TableHead>
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
              <TableCell className="sticky left-0 bg-background font-medium">{company.name}</TableCell>
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
