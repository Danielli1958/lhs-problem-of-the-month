export interface ProblemFormData {
  id?: string;
  title: string;
  description: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  points: number;
  month: string; // "YYYY-MM" while editing; stored as "YYYY-MM-01"
  due_date: string;
  hint: string;
  correct_answer: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  is_active: boolean;
}
