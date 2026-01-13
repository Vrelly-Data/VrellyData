import { PersonEntity, CompanyEntity } from '@/types/audience';

const MOCK_FIRST_NAMES = ['John', 'Jane', 'Michael', 'Sarah', 'David', 'Emily', 'Robert', 'Lisa', 'James', 'Jennifer'];
const MOCK_LAST_NAMES = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez'];
const MOCK_CITIES = ['New York', 'Los Angeles', 'Chicago', 'San Francisco', 'Boston', 'Austin', 'Seattle', 'Denver', 'Miami', 'Atlanta'];
const MOCK_COMPANIES = ['TechCorp', 'DataSoft', 'CloudInc', 'InnovateLabs', 'FutureSystems', 'DigitalWorks', 'SmartSolutions', 'NextGen', 'WebFlow', 'AppVentures'];
const MOCK_INDUSTRIES = ['Software', 'E-commerce', 'Consulting', 'Marketing', 'Sales', 'Finance', 'Healthcare', 'Manufacturing', 'Retail', 'Education'];
const MOCK_JOB_TITLES = ['Software Engineer', 'Marketing Manager', 'Sales Director', 'CTO', 'Product Manager', 'Data Analyst', 'UX Designer', 'Account Executive', 'VP of Operations', 'CEO'];
const MOCK_SENIORITY = ['Individual Contributor', 'Manager', 'Head of', 'Director', 'VP', 'President', 'C-Level'];
const MOCK_DEPARTMENTS = ['Community And Social Services', 'Customer Success', 'Engineering', 'C-Suite', 'Finance', 'Human Resources', 'Information Technology', 'Legal', 'Marketing', 'Operations', 'Product', 'Sales'];
const MOCK_GENDERS = ['male', 'female', 'other'];
const MOCK_SEGMENTS = ['Tech', 'Healthcare', 'Finance', 'Retail', 'Manufacturing'];

const MOCK_COMPANY_DESCRIPTIONS = [
  'Innovative software development company specializing in cloud solutions and enterprise applications',
  'Leading e-commerce platform providing sustainable products for conscious consumers',
  'Enterprise consulting firm focused on digital transformation and business optimization',
  'Marketing technology company helping brands grow their online presence',
  'Financial services provider with cutting-edge analytics and investment tools',
  'Healthcare technology improving patient outcomes through data-driven insights',
  'Manufacturing automation and robotics solutions for modern factories',
  'Retail management software for multi-location businesses and franchises',
  'Educational technology platform enabling remote learning and collaboration',
  'Data analytics company powered by artificial intelligence and machine learning',
  'Cybersecurity solutions protecting enterprise infrastructure and sensitive data',
  'Supply chain optimization software for logistics and distribution networks',
  'Cloud infrastructure provider for scalable web applications',
  'Mobile app development agency creating innovative user experiences',
  'Business intelligence platform for real-time decision making',
  'Human resources software streamlining talent acquisition and management',
  'Marketing automation tools for customer engagement and retention',
  'Payment processing solutions for online and offline transactions',
];

export interface MockAttributeOptions {
  industries: string[];
  cities: string[];
  jobTitles: string[];
  seniority: string[];
  departments: string[];
  companySizeRanges: string[];
  companyRevenueRanges: string[];
  netWorthRanges: string[];
  incomeRanges: string[];
}

export const MOCK_ATTRIBUTES: MockAttributeOptions = {
  industries: MOCK_INDUSTRIES,
  cities: MOCK_CITIES,
  jobTitles: MOCK_JOB_TITLES,
  seniority: MOCK_SENIORITY,
  departments: MOCK_DEPARTMENTS,
  companySizeRanges: ['1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5001-10000', '10000+'],
  companyRevenueRanges: ['Under $1M', '$1M - $10M', '$10M - $50M', '$50M - $100M', '$100M - $500M', '$500M - $1B', '$1B+'],
  netWorthRanges: ['Under $100K', '$100K - $500K', '$500K - $1M', '$1M - $5M', '$5M - $10M', '$10M - $50M', '$50M+'],
  incomeRanges: ['Under $50K', '$50K - $100K', '$100K - $200K', '$200K - $500K', '$500K - $1M', '$1M+'],
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
    const id = `person-${i}-${Date.now()}`;
    const firstName = randomElement(MOCK_FIRST_NAMES);
    const lastName = randomElement(MOCK_LAST_NAMES);
    const company = randomElement(MOCK_COMPANIES);
    
    people.push({
      id,
      name: `${firstName} ${lastName}`,
      title: randomElement(MOCK_JOB_TITLES),
      seniority: randomElement(MOCK_SENIORITY),
      department: randomElement(MOCK_DEPARTMENTS),
      location: randomElement(MOCK_CITIES),
      company: company,
      companySize: randomElement(['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+']),
      companyDescription: randomElement(MOCK_COMPANY_DESCRIPTIONS),
      industry: randomElement(MOCK_INDUSTRIES),
      technologies: [],
      age: randomInt(25, 65),
      gender: randomElement(MOCK_GENDERS),
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${company.toLowerCase()}.com`,
      phone: `+1-${randomInt(200, 999)}-${randomInt(200, 999)}-${randomInt(1000, 9999)}`,
      linkedin: `https://linkedin.com/in/${firstName.toLowerCase()}-${lastName.toLowerCase()}`,
      isUnlocked: false,
    });
  }
  
  return people;
}

export function generateMockCompanies(count: number): CompanyEntity[] {
  const companies: CompanyEntity[] = [];
  
  for (let i = 0; i < count; i++) {
    const id = `company-${i}-${Date.now()}`;
    const name = randomElement(MOCK_COMPANIES);
    
    companies.push({
      id,
      name: name,
      domain: `${name.toLowerCase().replace(/\s+/g, '')}.com`,
      industry: randomElement(MOCK_INDUSTRIES),
      employeeCount: randomInt(10, 5000),
      revenue: `$${randomInt(1, 100)}M`,
      location: randomElement(MOCK_CITIES),
      technologies: [],
      fundingStage: randomElement(['Seed', 'Series A', 'Series B', 'Series C', 'IPO', 'Acquired']),
      description: randomElement(MOCK_COMPANY_DESCRIPTIONS),
      linkedin: `https://linkedin.com/company/${name.toLowerCase().replace(/\s+/g, '-')}`,
      phone: `+1-${randomInt(200, 999)}-${randomInt(200, 999)}-${randomInt(1000, 9999)}`,
      isUnlocked: false,
    });
  }
  
  return companies;
}
