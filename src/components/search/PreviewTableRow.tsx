import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { PersonEntity, CompanyEntity } from '@/types/audience';
import { BlurredField } from './BlurredField';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

interface PreviewTableRowProps {
  entity: PersonEntity | CompanyEntity;
  entityType: 'person' | 'company';
  isUnlocked: (id: string) => boolean;
}

export function PreviewTableRow({ entity, entityType, isUnlocked }: PreviewTableRowProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (entityType === 'person') {
    const person = entity as PersonEntity;
    return (
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger className="w-full hover:bg-muted/50 transition-colors">
          <div className="px-4 py-3 flex items-center justify-between gap-4">
            <div className="flex-1 grid grid-cols-2 gap-4 text-sm text-left">
              <div className="font-medium">{person.name}</div>
              <div className="text-muted-foreground truncate">{person.title || 'N/A'}</div>
            </div>
            <ChevronRight 
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform flex-shrink-0",
                isOpen && "rotate-90"
              )} 
            />
          </div>
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <div className="px-4 pb-3 pt-0 grid grid-cols-2 gap-x-4 gap-y-2 text-sm border-t bg-muted/20">
            <div className="pt-3">
              <div className="text-xs text-muted-foreground mb-1">Email</div>
              <BlurredField 
                value={person.email || 'N/A'} 
                isUnlocked={isUnlocked(person.id)} 
              />
            </div>
            <div className="pt-3">
              <div className="text-xs text-muted-foreground mb-1">LinkedIn</div>
              <BlurredField 
                value={person.linkedin || 'N/A'} 
                isUnlocked={isUnlocked(person.id)} 
              />
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Seniority</div>
              <div>{person.seniority || 'N/A'}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Department</div>
              <div>{person.department || 'N/A'}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Company</div>
              <div>{person.company || 'N/A'}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Location</div>
              <div>{person.location || 'N/A'}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Company Size</div>
              <div>{person.companySize || 'N/A'}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Industry</div>
              <div>{person.industry || 'N/A'}</div>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  // Company entity
  const company = entity as CompanyEntity;
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="w-full hover:bg-muted/50 transition-colors">
        <div className="px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex-1 grid grid-cols-2 gap-4 text-sm text-left">
            <div className="font-medium">{company.name}</div>
            <div className="text-muted-foreground truncate">{company.industry || 'N/A'}</div>
          </div>
          <ChevronRight 
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform flex-shrink-0",
              isOpen && "rotate-90"
            )} 
          />
        </div>
      </CollapsibleTrigger>
      
      <CollapsibleContent>
        <div className="px-4 pb-3 pt-0 grid grid-cols-2 gap-x-4 gap-y-2 text-sm border-t bg-muted/20">
          <div className="pt-3">
            <div className="text-xs text-muted-foreground mb-1">Domain</div>
            <div>{company.domain || 'N/A'}</div>
          </div>
          <div className="pt-3">
            <div className="text-xs text-muted-foreground mb-1">Employees</div>
            <div>{company.employeeCount || 'N/A'}</div>
          </div>
          <div className="col-span-2">
            <div className="text-xs text-muted-foreground mb-1">Description</div>
            <div className="text-muted-foreground">{company.description || 'N/A'}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Location</div>
            <div>{company.location || 'N/A'}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">LinkedIn</div>
            <BlurredField 
              value={company.linkedin || 'N/A'} 
              isUnlocked={isUnlocked(company.id)} 
            />
          </div>
          {company.phone && (
            <div>
              <div className="text-xs text-muted-foreground mb-1">Phone</div>
              <BlurredField 
                value={company.phone} 
                isUnlocked={isUnlocked(company.id)} 
              />
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
