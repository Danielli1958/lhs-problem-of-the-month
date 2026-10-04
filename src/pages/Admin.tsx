import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, RotateCcw, Archive, ArchiveRestore } from 'lucide-react';
import { ProblemFormData } from '@/types/admin';
import { toast } from 'sonner';
import { resetYearlyLeaderboard } from '@/lib/admin';
import { formatProblemMonth } from '@/lib/utils';

const pad = (n: number) => String(n).padStart(2, '0');

// Defaults a new problem to the current month, due at the end of it.
const getInitialFormData = (): ProblemFormData => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const lastDay = new Date(year, month, 0).getDate();
  return {
    ...initialFormData,
    month: `${year}-${pad(month)}`,
    due_date: `${year}-${pad(month)}-${pad(lastDay)}T23:59`,
  };
};

const initialFormData: ProblemFormData = {
  title: '',
  description: '',
  difficulty: 'Medium',
  points: 10,
  month: '',
  due_date: '',
  hint: '',
  correct_answer: 'A',
  option_a: '',
  option_b: '',
  option_c: '',
  option_d: '',
  is_active: true,
};

export default function Admin() {
  const [problems, setProblems] = useState<any[]>([]);
  const [formData, setFormData] = useState<ProblemFormData>(getInitialFormData());
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [activeTab, setActiveTab] = useState("manage-problems");
  const [isResettingLeaderboard, setIsResettingLeaderboard] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    checkUser();
  }, []);

  const checkUser = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate('/auth');
        return;
      }

      const { data: profile } = await supabase
        .from('potm_profiles')
        .select('is_admin')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!profile?.is_admin) {
        toast.error('Unauthorized access');
        navigate('/');
        return;
      }

      setIsAdmin(true);
      await fetchProblems();
    } catch (error) {
      console.error('Error checking admin status:', error);
      toast.error('Error verifying permissions');
      navigate('/');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchProblems = async () => {
    try {
      const { data, error } = await supabase
        .from('potm_problems')
        .select('*')
        .order('month', { ascending: true })
        .order('created_at', { ascending: false });

      if (error) throw error;
      setProblems(data || []);
    } catch (error) {
      console.error('Error fetching problems:', error);
      toast.error('Failed to load problems');
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: name === 'points' ? Number(value) : value
    }));
  };

  const handleSelectChange = (name: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [name]: name === 'is_active' ? value === 'true' : value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // The month picker yields "YYYY-MM"; the column stores the 1st of the month
    const payload = { ...formData, month: `${formData.month}-01` };
    try {
      if (isEditing && formData.id) {
        const { error } = await supabase
          .from('potm_problems')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', formData.id);

        if (error) throw error;
        toast.success('Problem updated successfully');
        setActiveTab("manage-problems");
      } else {
        const { error } = await supabase
          .from('potm_problems')
          .insert([payload]);

        if (error) throw error;
        toast.success('Problem added successfully');
        resetForm();
      }
      
      fetchProblems();
    } catch (error) {
      console.error('Error saving problem:', error);
      toast.error('Failed to save problem');
    }
  };

  const handleEdit = (problem: any) => {
    // Leave out trigger-maintained columns so saving an edit can't clobber them
    const { submitted_user_ids, created_at, updated_at, ...editable } = problem;
    setFormData({
      ...editable,
      month: problem.month ? problem.month.slice(0, 7) : '',
      due_date: problem.due_date ? problem.due_date.slice(0, 16) : ''
    });
    setIsEditing(true);
    setActiveTab("add-problem");
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleArchive = async (id: string) => {
    try {
      const { error } = await supabase
        .from('potm_problems')
        .update({ is_archived: true, is_active: false })
        .eq('id', id);

      if (error) throw error;

      toast.success('Problem archived');
      fetchProblems();
    } catch (error) {
      console.error('Error archiving problem:', error);
      toast.error('Failed to archive problem');
    }
  };

  const handleUnarchive = async (id: string) => {
    try {
      const { error } = await supabase
        .from('potm_problems')
        .update({ is_archived: false })
        .eq('id', id);

      if (error) throw error;

      toast.success('Problem unarchived');
      fetchProblems();
    } catch (error) {
      console.error('Error unarchiving problem:', error);
      toast.error('Failed to unarchive problem');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this problem?')) return;
    
    try {
      const { error } = await supabase
        .from('potm_problems')
        .delete()
        .eq('id', id);

      if (error) throw error;
      
      toast.success('Problem deleted successfully');
      fetchProblems();
    } catch (error) {
      console.error('Error deleting problem:', error);
      toast.error('Failed to delete problem');
    }
  };

  const resetForm = () => {
    setFormData(getInitialFormData());
    setIsEditing(false);
  };

  const handleResetLeaderboard = async () => {
    const confirmed = window.confirm(
      "Start a new school year? This will reset every student's points, problems solved, " +
      "and streak back to 0 on the leaderboard. Their All-Time totals will NOT be affected. " +
      "This cannot be undone."
    );
    if (!confirmed) return;

    setIsResettingLeaderboard(true);
    try {
      await resetYearlyLeaderboard();
      toast.success('Leaderboard reset for the new school year');
    } catch (error) {
      console.error('Error resetting leaderboard:', error);
      toast.error('Failed to reset leaderboard');
    } finally {
      setIsResettingLeaderboard(false);
    }
  };

  if (isLoading || isAdmin === null) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

  const activeProblems = problems.filter((problem) => !problem.is_archived);
  const archivedProblems = problems.filter((problem) => problem.is_archived);

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Access Denied</h1>
          <p>You don't have permission to view this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 max-w-6xl">
      <h1 className="text-3xl font-bold mb-6">Admin Dashboard</h1>
      
      <Tabs 
        value={activeTab}
        onValueChange={(value) => {
          setActiveTab(value);
          if (value === 'add-problem') {
            resetForm();
          }
        }}
        className="space-y-4"
      >
        <TabsList>
          <TabsTrigger value="manage-problems">Manage Problems</TabsTrigger>
          <TabsTrigger value="add-problem">Add New Problem</TabsTrigger>
          <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
        </TabsList>

        <TabsContent value="add-problem">
          <Card>
            <CardHeader>
              <CardTitle>{isEditing ? 'Edit Problem' : 'Add New Problem'}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={(e) => {
                e.preventDefault();
                handleSubmit(e);
                if (isEditing) {
                  setIsEditing(false);
                  resetForm();
                }
              }} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Title</label>
                    <Input
                      name="title"
                      value={formData.title}
                      onChange={handleInputChange}
                      required
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Difficulty</label>
                    <Select
                      value={formData.difficulty}
                      onValueChange={(value) => handleSelectChange('difficulty', value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select difficulty" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Easy">Easy</SelectItem>
                        <SelectItem value="Medium">Medium</SelectItem>
                        <SelectItem value="Hard">Hard</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Points</label>
                    <Input
                      type="number"
                      name="points"
                      value={formData.points}
                      onChange={handleInputChange}
                      min="1"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Month</label>
                    <Input
                      type="month"
                      name="month"
                      value={formData.month}
                      onChange={handleInputChange}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Due Date</label>
                    <Input
                      type="datetime-local"
                      name="due_date"
                      value={formData.due_date}
                      onChange={handleInputChange}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Status</label>
                    <Select
                      value={String(formData.is_active)}
                      onValueChange={(value) => handleSelectChange('is_active', value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="true">Active</SelectItem>
                        <SelectItem value="false">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Problem</label>
                  <Textarea
                    name="description"
                    value={formData.description}
                    onChange={handleInputChange}
                    rows={4}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Hint (Optional)</label>
                  <Textarea
                    name="hint"
                    value={formData.hint}
                    onChange={handleInputChange}
                    rows={4}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {['A', 'B', 'C', 'D'].map((option) => (
                    <div key={option} className="space-y-2">
                      <label className="text-sm font-medium">Option {option}</label>
                      <div className="flex items-center space-x-2">
                        <Input
                          name={`option_${option.toLowerCase()}` as keyof ProblemFormData}
                          value={formData[`option_${option.toLowerCase()}` as keyof ProblemFormData] as string}
                          onChange={handleInputChange}
                          required
                        />
                        <input
                          type="radio"
                          name="correct_answer"
                          checked={formData.correct_answer === option}
                          onChange={() => handleSelectChange('correct_answer', option)}
                          className="h-4 w-4"
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex justify-end space-x-2 pt-4">
                  <Button type="submit">
                    {isEditing ? 'Update Problem' : 'Add Problem'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="manage-problems">
          <Card>
            <CardHeader>
              <CardTitle className="flex justify-between items-center">
                <span>Manage Problems</span>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => {
                    resetForm();
                    setActiveTab("add-problem");
                  }}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add New Problem
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {activeProblems.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">
                  No problems found. Add your first problem above.
                </p>
              ) : (
                <div className="space-y-4">
                  {activeProblems.map((problem) => (
                    <div key={problem.id} className="border rounded-lg p-4 flex justify-between items-center">
                      <div>
                        <h3 className="font-medium">{problem.title}</h3>
                        <p className="text-sm text-muted-foreground">
                          {formatProblemMonth(problem.month)} • {problem.difficulty} • {problem.points} points •
                          Status: <span className={problem.is_active ? 'text-green-600' : 'text-amber-600'}>
                            {problem.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </p>
                      </div>
                      <div className="flex space-x-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEdit(problem)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleArchive(problem.id)}
                        >
                          <Archive className="h-4 w-4 mr-2" />
                          Archive
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDelete(problem.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Archived Problems</CardTitle>
            </CardHeader>
            <CardContent>
              {archivedProblems.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">
                  No archived problems yet.
                </p>
              ) : (
                <div className="space-y-4">
                  {archivedProblems.map((problem) => (
                    <div key={problem.id} className="border rounded-lg p-4 flex justify-between items-center opacity-75">
                      <div>
                        <h3 className="font-medium">{problem.title}</h3>
                        <p className="text-sm text-muted-foreground">
                          {formatProblemMonth(problem.month)} • {problem.difficulty} • {problem.points} points
                        </p>
                      </div>
                      <div className="flex space-x-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleUnarchive(problem.id)}
                        >
                          <ArchiveRestore className="h-4 w-4 mr-2" />
                          Unarchive
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDelete(problem.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="leaderboard">
          <Card>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Reset the leaderboard at the start of every year
              </p>
              <Button
                variant="destructive"
                onClick={handleResetLeaderboard}
                disabled={isResettingLeaderboard}
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                {isResettingLeaderboard ? 'Resetting...' : 'Reset Leaderboard for New School Year'}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
