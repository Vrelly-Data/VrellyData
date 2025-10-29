import { PersonEntity, CompanyEntity } from '@/types/audience';

const MOCK_FIRST_NAMES = ['John', 'Jane', 'Michael', 'Sarah', 'David', 'Emily', 'Robert', 'Lisa', 'James', 'Jennifer'];
const MOCK_LAST_NAMES = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez'];
const MOCK_CITIES = ['New York', 'Los Angeles', 'Chicago', 'San Francisco', 'Boston', 'Austin', 'Seattle', 'Denver', 'Miami', 'Atlanta'];
const MOCK_COMPANIES = ['TechCorp', 'DataSoft', 'CloudInc', 'InnovateLabs', 'FutureSystems', 'DigitalWorks', 'SmartSolutions', 'NextGen', 'WebFlow', 'AppVentures'];
const MOCK_INDUSTRIES = ['Software', 'E-commerce', 'Consulting', 'Marketing', 'Sales', 'Finance', 'Healthcare', 'Manufacturing', 'Retail', 'Education'];
const MOCK_JOB_TITLES = ['Software Engineer', 'Marketing Manager', 'Sales Director', 'CTO', 'Product Manager', 'Data Analyst', 'UX Designer', 'Account Executive', 'VP of Operations', 'CEO'];
const MOCK_SENIORITY = ['Junior', 'Mid', 'Senior', 'Director', 'VP', 'C-Level'];
const MOCK_DEPARTMENTS = ['Engineering', 'Sales', 'Marketing', 'Operations', 'Finance', 'Product', 'Customer Success'];
const MOCK_GENDERS = ['male', 'female', 'other'];
const MOCK_SEGMENTS = ['Tech', 'Healthcare', 'Finance', 'Retail', 'Manufacturing'];

export interface MockAttributeOptions {
  segments: string[];
  industries: string[];
  departments: string[];
  seniority: string[];
  cities: string[];
  gender: string[];
  jobTitles: string[];
  companySize: string[];
  fundingStage: string[];
}

export const MOCK_ATTRIBUTES: MockAttributeOptions = {
  segments: MOCK_SEGMENTS,
  industries: MOCK_INDUSTRIES,
  departments: MOCK_DEPARTMENTS,
  seniority: MOCK_SENIORITY,
  cities: MOCK_CITIES,
  gender: MOCK_GENDERS,
  jobTitles: MOCK_JOB_TITLES,
  companySize: ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+'],
  fundingStage: ['Seed', 'Series A', 'Series B', 'Series C', 'IPO', 'Acquired'],
};

function randomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function generateMockPeople(count: number): PersonEntity[] {
  const people: PersonEntity[] = [];
  
  for (let i = 0; i < count; i++) {
    const firstName = randomElement(MOCK_FIRST_NAMES);
    const lastName = randomElement(MOCK_LAST_NAMES);
    const company = randomElement(MOCK_COMPANIES);
    
    people.push({
      id: `person-${i}-${Date.now()}`,
      name: `${firstName} ${lastName}`,
      title: randomElement(MOCK_JOB_TITLES),
      seniority: randomElement(MOCK_SENIORITY),
      department: randomElement(MOCK_DEPARTMENTS),
      location: randomElement(MOCK_CITIES),
      company: company,
      companySize: randomElement(['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+']),
      industry: randomElement(MOCK_INDUSTRIES),
      technologies: [],
      age: randomInt(25, 65),
      gender: randomElement(MOCK_GENDERS),
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${company.toLowerCase()}.com`,
      phone: `+1-${randomInt(200, 999)}-${randomInt(200, 999)}-${randomInt(1000, 9999)}`,
      linkedin: `https://linkedin.com/in/${firstName.toLowerCase()}-${lastName.toLowerCase()}`,
    });
  }
  
  return people;
}

export function generateMockCompanies(count: number): CompanyEntity[] {
  const companies: CompanyEntity[] = [];
  
  for (let i = 0; i < count; i++) {
    const name = randomElement(MOCK_COMPANIES);
    
    companies.push({
      id: `company-${i}-${Date.now()}`,
      name: name,
      domain: `${name.toLowerCase().replace(/\s+/g, '')}.com`,
      industry: randomElement(MOCK_INDUSTRIES),
      employeeCount: randomInt(10, 5000),
      revenue: `$${randomInt(1, 100)}M`,
      location: randomElement(MOCK_CITIES),
      technologies: [],
      fundingStage: randomElement(['Seed', 'Series A', 'Series B', 'Series C', 'IPO', 'Acquired']),
      description: `Leading ${randomElement(MOCK_INDUSTRIES)} company`,
    });
  }
  
  return companies;
}
