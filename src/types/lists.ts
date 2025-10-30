export interface List {
  id: string;
  team_id: string;
  name: string;
  entity_type: 'person' | 'company';
  description: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ListItem {
  id: string;
  list_id: string;
  entity_external_id: string;
  entity_data: any;
  added_at: string;
  added_by: string;
}

export interface ListWithCount extends List {
  item_count: number;
}
