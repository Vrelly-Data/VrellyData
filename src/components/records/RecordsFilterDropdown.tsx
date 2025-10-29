import { useState } from 'react';
import { Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { EntityType } from '@/types/audience';

interface RecordsFilterDropdownProps {
  entityType: EntityType;
}

export function RecordsFilterDropdown({ entityType }: RecordsFilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const [activeFilters, setActiveFilters] = useState(0);

  const handleClearAll = () => {
    setActiveFilters(0);
    // TODO: Implement actual filter clearing logic
  };

  const handleApply = () => {
    setOpen(false);
    // TODO: Implement actual filter application logic
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Filter className="h-4 w-4" />
          Filters
          {activeFilters > 0 && (
            <Badge variant="secondary" className="ml-1 h-5 px-1.5">
              {activeFilters}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex flex-col h-[500px]">
          <div className="p-4 border-b">
            <h3 className="font-semibold">Filters</h3>
          </div>
          
          <ScrollArea className="flex-1">
            <Accordion type="multiple" className="px-2 py-2">
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

          <div className="p-4 border-t flex gap-2">
            <Button variant="outline" size="sm" onClick={handleClearAll} className="flex-1">
              Clear All
            </Button>
            <Button size="sm" onClick={handleApply} className="flex-1">
              Apply
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
