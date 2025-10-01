import { FilterDSL, PersonEntity, CompanyEntity, EntityType } from '@/types/audience';

// Mock data for demo
const MOCK_PEOPLE: PersonEntity[] = [
  {
    id: 'p1',
    name: 'Sarah Johnson',
    title: 'VP of Sales',
    seniority: 'VP',
    department: 'Sales',
    location: 'San Francisco, CA',
    company: 'TechCorp Inc',
    companySize: '501-1000',
    industry: 'Software',
    technologies: ['Salesforce', 'HubSpot', 'Outreach'],
  },
  {
    id: 'p2',
    name: 'Michael Chen',
    title: 'Director of Marketing',
    seniority: 'Director',
    department: 'Marketing',
    location: 'New York, NY',
    company: 'DataFlow Solutions',
    companySize: '201-500',
    industry: 'SaaS',
    technologies: ['Marketo', 'Google Analytics', 'Salesforce'],
  },
  {
    id: 'p3',
    name: 'Emily Rodriguez',
    title: 'CTO',
    seniority: 'Exec',
    department: 'Engineering',
    location: 'Austin, TX',
    company: 'CloudScale Systems',
    companySize: '101-200',
    industry: 'Cloud Services',
    technologies: ['AWS', 'Kubernetes', 'Datadog'],
  },
  {
    id: 'p4',
    name: 'David Kim',
    title: 'Head of Revenue Operations',
    seniority: 'VP',
    department: 'RevOps',
    location: 'Seattle, WA',
    company: 'GrowthMetrics',
    companySize: '51-100',
    industry: 'Analytics',
    technologies: ['Salesforce', 'Tableau', 'dbt'],
  },
  {
    id: 'p5',
    name: 'Lisa Thompson',
    title: 'Senior Sales Manager',
    seniority: 'Manager',
    department: 'Sales',
    location: 'Boston, MA',
    company: 'Enterprise Software Co',
    companySize: '1001+',
    industry: 'Enterprise Software',
    technologies: ['Microsoft Dynamics', 'LinkedIn Sales Navigator'],
  },
];

const MOCK_COMPANIES: CompanyEntity[] = [
  {
    id: 'c1',
    name: 'TechCorp Inc',
    domain: 'techcorp.com',
    industry: 'Software',
    employeeCount: 750,
    revenue: '$50M-$100M',
    location: 'San Francisco, CA',
    technologies: ['Salesforce', 'AWS', 'HubSpot'],
    fundingStage: 'Series C',
    description: 'Leading B2B SaaS platform',
  },
  {
    id: 'c2',
    name: 'DataFlow Solutions',
    domain: 'dataflow.io',
    industry: 'SaaS',
    employeeCount: 320,
    revenue: '$20M-$50M',
    location: 'New York, NY',
    technologies: ['Google Cloud', 'Snowflake', 'dbt'],
    fundingStage: 'Series B',
    description: 'Data integration platform',
  },
  {
    id: 'c3',
    name: 'CloudScale Systems',
    domain: 'cloudscale.com',
    industry: 'Cloud Services',
    employeeCount: 180,
    revenue: '$10M-$20M',
    location: 'Austin, TX',
    technologies: ['AWS', 'Kubernetes', 'Terraform'],
    fundingStage: 'Series A',
    description: 'Cloud infrastructure automation',
  },
  {
    id: 'c4',
    name: 'GrowthMetrics',
    domain: 'growthmetrics.com',
    industry: 'Analytics',
    employeeCount: 85,
    revenue: '$5M-$10M',
    location: 'Seattle, WA',
    technologies: ['BigQuery', 'Looker', 'Segment'],
    fundingStage: 'Seed',
    description: 'Revenue analytics platform',
  },
];

export interface SearchParams {
  filters: FilterDSL;
  limit?: number;
  cursor?: string;
}

export interface SearchResponse<T> {
  items: T[];
  totalEstimate: number;
  nextCursor?: string;
  facets?: any;
}

export interface UnlockResponse {
  unlocked: boolean;
  cost: number;
  contact: {
    email?: string;
    phone?: string;
    linkedin?: string;
  };
}

class AudienceLabClient {
  private baseUrl = 'https://api.audiencelab.example'; // Mock URL
  private apiKey = 'mock-api-key'; // Will be replaced with real key

  async searchPeople(params: SearchParams): Promise<SearchResponse<PersonEntity>> {
    // Mock implementation - in production, this would call the real API
    await this.delay(500); // Simulate network delay
    
    return {
      items: MOCK_PEOPLE,
      totalEstimate: MOCK_PEOPLE.length,
      facets: {
        seniority: { VP: 2, Director: 1, Exec: 1, Manager: 1 },
        department: { Sales: 2, Marketing: 1, Engineering: 1, RevOps: 1 },
      },
    };
  }

  async searchCompanies(params: SearchParams): Promise<SearchResponse<CompanyEntity>> {
    // Mock implementation
    await this.delay(500);
    
    return {
      items: MOCK_COMPANIES,
      totalEstimate: MOCK_COMPANIES.length,
      facets: {
        industry: { Software: 1, SaaS: 1, 'Cloud Services': 1, Analytics: 1 },
        employeeCount: { '51-100': 1, '101-200': 1, '201-500': 1, '501-1000': 1 },
      },
    };
  }

  async unlockContact(entityId: string, entityType: EntityType): Promise<UnlockResponse> {
    // Mock implementation
    await this.delay(300);
    
    return {
      unlocked: true,
      cost: 1,
      contact: {
        email: `${entityId}@example.com`,
        phone: '+1-555-0100',
        linkedin: `https://linkedin.com/in/${entityId}`,
      },
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const audienceLabClient = new AudienceLabClient();
