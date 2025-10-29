import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { EntityType } from '@/types/audience';

interface RecordsFiltersProps {
  entityType: EntityType;
}

export function RecordsFilters({ entityType }: RecordsFiltersProps) {
  return (
    <div className="w-64 border-r bg-muted/40 flex flex-col">
      <div className="p-4 border-b">
        <h3 className="font-semibold">Filters</h3>
      </div>
      
      <ScrollArea className="flex-1">
        <Accordion type="multiple" className="px-2">
          <AccordionItem value="lists">
            <AccordionTrigger className="text-sm">Lists</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Checkbox id="all-records" />
                  <Label htmlFor="all-records" className="text-sm font-normal">All Records</Label>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="industries">
            <AccordionTrigger className="text-sm">Industries</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Checkbox id="tech" />
                  <Label htmlFor="tech" className="text-sm font-normal">Technology</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox id="finance" />
                  <Label htmlFor="finance" className="text-sm font-normal">Finance</Label>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {entityType === 'person' && (
            <>
              <AccordionItem value="titles">
                <AccordionTrigger className="text-sm">Job Titles</AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <Checkbox id="ceo" />
                      <Label htmlFor="ceo" className="text-sm font-normal">CEO</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox id="cto" />
                      <Label htmlFor="cto" className="text-sm font-normal">CTO</Label>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="seniority">
                <AccordionTrigger className="text-sm">Seniority</AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <Checkbox id="c-level" />
                      <Label htmlFor="c-level" className="text-sm font-normal">C-Level</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox id="director" />
                      <Label htmlFor="director" className="text-sm font-normal">Director</Label>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </>
          )}

          {entityType === 'company' && (
            <AccordionItem value="size">
              <AccordionTrigger className="text-sm">Company Size</AccordionTrigger>
              <AccordionContent>
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox id="1-10" />
                    <Label htmlFor="1-10" className="text-sm font-normal">1-10</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox id="11-50" />
                    <Label htmlFor="11-50" className="text-sm font-normal">11-50</Label>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          )}

          <AccordionItem value="locations">
            <AccordionTrigger className="text-sm">Locations</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Checkbox id="us" />
                  <Label htmlFor="us" className="text-sm font-normal">United States</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox id="uk" />
                  <Label htmlFor="uk" className="text-sm font-normal">United Kingdom</Label>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </ScrollArea>
    </div>
  );
}
