export abstract class BaseMergeStrategy<T> {
  // Common methods all strategies share
  abstract handleConflict(key: keyof T, v1: any, v2: any): any;

  // Type-safe approach to forcing implementation for specific fields
  // In a real ORM plugin (like Drizzle), this class would be tightly coupled 
  // to the Zod schema you define for the column.
}

// Example usage that the user would write:
export class UserProfileMerger extends BaseMergeStrategy<any> {
  
  handleConflict(key: string, v1: any, v2: any): any {
    switch (key) {
      case 'tags':
        // Overwrite array merge strategy: combine arrays
        return [...new Set([...v1, ...v2])];
      case 'embedding':
        // Custom math for vectors
        return v1.map((val: number, i: number) => (val + v2[i]) / 2);
      default:
        // Return undefined to tell the C core to use the default strategy
        return undefined; 
    }
  }
}
