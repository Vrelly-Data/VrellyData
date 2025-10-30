import { PersonEntity, CompanyEntity } from '@/types/audience';

export interface PeopleInsights {
  total: number;
  industryDistribution: Record<string, number>;
  locationDistribution: Record<string, number>;
  titleDistribution: Record<string, number>;
  seniorityDistribution: Record<string, number>;
  departmentDistribution: Record<string, number>;
  genderDistribution: Record<string, number>;
}

export interface CompanyInsights {
  total: number;
  industryDistribution: Record<string, number>;
  locationDistribution: Record<string, number>;
  employeeSizeDistribution: Record<string, number>;
  fundingStageDistribution: Record<string, number>;
}

export class AnalyticsService {
  static calculatePeopleInsights(people: PersonEntity[]): PeopleInsights {
    return {
      total: people.length,
      industryDistribution: this.groupByField(people, 'industry'),
      locationDistribution: this.groupByField(people, 'location'),
      titleDistribution: this.groupByField(people, 'title'),
      seniorityDistribution: this.groupByField(people, 'seniority'),
      departmentDistribution: this.groupByField(people, 'department'),
      genderDistribution: this.groupByField(people, 'gender'),
    };
  }

  static calculateCompanyInsights(companies: CompanyEntity[]): CompanyInsights {
    const employeeSizeGroups = this.groupByEmployeeSize(companies);
    
    return {
      total: companies.length,
      industryDistribution: this.groupByField(companies, 'industry'),
      locationDistribution: this.groupByField(companies, 'location'),
      employeeSizeDistribution: employeeSizeGroups,
      fundingStageDistribution: this.groupByField(companies, 'fundingStage'),
    };
  }

  private static groupByField(data: any[], field: string): Record<string, number> {
    const grouped: Record<string, number> = {};
    
    data.forEach(item => {
      const value = item[field];
      if (value) {
        grouped[value] = (grouped[value] || 0) + 1;
      }
    });
    
    return grouped;
  }

  private static groupByEmployeeSize(companies: CompanyEntity[]): Record<string, number> {
    const groups: Record<string, number> = {
      '1-10': 0,
      '11-50': 0,
      '51-200': 0,
      '201-500': 0,
      '501-1000': 0,
      '1000+': 0,
    };
    
    companies.forEach(company => {
      const count = company.employeeCount;
      if (!count) return;
      
      if (count <= 10) groups['1-10']++;
      else if (count <= 50) groups['11-50']++;
      else if (count <= 200) groups['51-200']++;
      else if (count <= 500) groups['201-500']++;
      else if (count <= 1000) groups['501-1000']++;
      else groups['1000+']++;
    });
    
    return groups;
  }

  static getTopN(distribution: Record<string, number>, n: number): Record<string, number> {
    const entries = Object.entries(distribution);
    entries.sort((a, b) => b[1] - a[1]);
    
    const topN = entries.slice(0, n);
    const result: Record<string, number> = {};
    
    topN.forEach(([key, value]) => {
      result[key] = value;
    });
    
    if (entries.length > n) {
      const othersCount = entries.slice(n).reduce((sum, [, count]) => sum + count, 0);
      if (othersCount > 0) {
        result['Others'] = othersCount;
      }
    }
    
    return result;
  }
}
