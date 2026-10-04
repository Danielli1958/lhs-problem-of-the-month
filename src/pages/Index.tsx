import { useEffect, useState, useCallback } from "react";
import { Header } from "@/components/Header";
import { ProblemCard } from "@/components/ProblemCard";
import { Leaderboard } from "@/components/Leaderboard";
import { StatsCard } from "@/components/StatsCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Trophy, Brain, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { User, Session } from "@supabase/supabase-js";

interface Problem {
  id: string;
  title: string;
  description: string;
  difficulty: "Easy" | "Medium" | "Hard";
  points: number;
  month: string;
  due_date: string;
  hint: string | null;
  correct_answer: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
}

interface Profile {
  display_name: string;
  total_points: number;
  problems_solved: number;
  current_streak: number;
}

interface LeaderboardEntry {
  rank: number;
  display_name: string;
  total_points: number;
  problems_solved: number;
  current_streak: number;
  user_id?: string;
}

type ProfileForRanking = {
  user_id?: string;
  total_points?: number;
  problems_solved?: number;
  display_name?: string;
  current_streak?: number;
  all_time_points?: number;
  all_time_problems_solved?: number;
};

const assignAllTimeRanks = (profiles: ProfileForRanking[]) => {
  const sortedProfiles = [...profiles].sort((a, b) => {
    if ((b.all_time_points || 0) !== (a.all_time_points || 0)) {
      return (b.all_time_points || 0) - (a.all_time_points || 0);
    }
    if ((b.all_time_problems_solved || 0) !== (a.all_time_problems_solved || 0)) {
      return (b.all_time_problems_solved || 0) - (a.all_time_problems_solved || 0);
    }
    return (a.display_name || '').localeCompare(b.display_name || '');
  });

  return sortedProfiles.map((profile, index) => ({
    ...profile,
    rank: index + 1
  }));
};

const assignRanks = (profiles: ProfileForRanking[], activeProblemSubmissionIndices: Map<string, number>, previousProblemSubmissionIndices: Map<string, number>) => {
    const sortedProfiles = [...profiles].sort((a, b) => {
      if (b.total_points !== a.total_points) {
        return b.total_points - a.total_points;
      }
      if (b.problems_solved !== a.problems_solved) {
        return b.problems_solved - a.problems_solved;
      }
      const aActiveIndex = activeProblemSubmissionIndices.get(a.user_id);
      const bActiveIndex = activeProblemSubmissionIndices.get(b.user_id);
      
      if (aActiveIndex !== undefined && bActiveIndex !== undefined) {
        return aActiveIndex - bActiveIndex;
      }
      if (aActiveIndex !== undefined && bActiveIndex === undefined) {
        return -1;
      }
      if (aActiveIndex === undefined && bActiveIndex !== undefined) {
        return 1;
      }
      const aPreviousIndex = previousProblemSubmissionIndices.get(a.user_id);
      const bPreviousIndex = previousProblemSubmissionIndices.get(b.user_id);
      
      if (aPreviousIndex !== undefined && bPreviousIndex !== undefined) {
        return aPreviousIndex - bPreviousIndex;
      }
      if (aPreviousIndex !== undefined && bPreviousIndex === undefined) {
        return -1;
      }
      if (aPreviousIndex === undefined && bPreviousIndex !== undefined) {
        return 1;
      }
      return 0;
    });

    const rankedProfiles = sortedProfiles.map((profile, index) => ({
      ...profile,
      rank: index + 1
    }));

  return rankedProfiles;
};

const Index = () => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [currentProblem, setCurrentProblem] = useState<Problem | null>(null);
  const [previousProblem, setPreviousProblem] = useState<Problem | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [allTimeLeaderboard, setAllTimeLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [userProfile, setUserProfile] = useState<Profile | null>(null);
  const [potmProfileReady, setPotmProfileReady] = useState(false);

  const updateLeaderboard = useCallback(async () => {
    try {
      const { data: profiles, error } = await supabase
        .from("potm_profiles")
        .select("display_name, total_points, problems_solved, current_streak, user_id, updated_at, all_time_points, all_time_problems_solved");

      if (error) throw error;

      if (profiles && profiles.length > 0) {
        const rankedAllTimeProfiles = assignAllTimeRanks(profiles);
        const allTimeTop5 = rankedAllTimeProfiles.slice(0, 5);
        const allTimeCurrentUserInTop5 = user ? allTimeTop5.some(u => u.user_id === user.id) : false;
        const allTimeCurrentUser = user && !allTimeCurrentUserInTop5
          ? rankedAllTimeProfiles.find(p => p.user_id === user.id)
          : null;
        const allTimeEntries = allTimeCurrentUser ? [...allTimeTop5, allTimeCurrentUser] : allTimeTop5;

        setAllTimeLeaderboard(
          allTimeEntries
            .map((p) => ({
              rank: p.rank,
              display_name: p.display_name || 'Anonymous',
              total_points: p.all_time_points || 0,
              problems_solved: p.all_time_problems_solved || 0,
              current_streak: 0,
              user_id: p.user_id,
              is_current_user: user ? p.user_id === user.id : false
            }))
            .sort((a, b) => a.rank - b.rank)
        );
        const activeProblemSubmissionIndices = await getProblemSubmissionIndices(currentProblem?.id || null);
        const previousProblemSubmissionIndices = await getProblemSubmissionIndices(previousProblem?.id || null);
        
        const rankedProfiles = assignRanks(profiles, activeProblemSubmissionIndices, previousProblemSubmissionIndices);
        
        if (user) {
          const currentUserProfile = rankedProfiles.find(p => p.user_id === user.id);
          if (currentUserProfile) {
            setUserProfile({
              display_name: currentUserProfile.display_name || user.email || '',
              total_points: currentUserProfile.total_points || 0,
              problems_solved: currentUserProfile.problems_solved || 0,
              current_streak: currentUserProfile.current_streak || 0
            });
            setUserRank(currentUserProfile.rank || 0);
          }
        }
        
        const top5 = rankedProfiles.slice(0, 5);
        
        const currentUserInTop5 = user ? top5.some(u => u.user_id === user.id) : false;
        
        const currentUser = user && !currentUserInTop5 ? rankedProfiles.find(p => p.user_id === user.id) : null;
        const leaderboardEntries = currentUser ? [...top5, currentUser] : top5;
        
        const formattedEntries = leaderboardEntries.map((p) => ({
          rank: p.rank,
          display_name: p.display_name || 'Anonymous',
          total_points: p.total_points || 0,
          problems_solved: p.problems_solved || 0,
          current_streak: p.current_streak || 0,
          user_id: p.user_id,
          is_current_user: user ? p.user_id === user.id : false
        }));
        
        const sortedEntries = [...formattedEntries].sort((a, b) => a.rank - b.rank);
        setLeaderboard(sortedEntries);
      }
    } catch (error) {
      console.error('Error updating leaderboard:', error);
    }
  }, [user, currentProblem, previousProblem, potmProfileReady]);

  const handlePointsUpdate = useCallback(async (pointsEarned: number, isCorrect: boolean, submissionTimestamp?: string) => {
    console.log('Updating points:', { pointsEarned, isCorrect, user, submissionTimestamp });
    
    setUserProfile(prev => {
      if (!prev) return prev;
      const newStreak = isCorrect ? (prev.current_streak || 0) + 1 : 0;
      return {
        ...prev,
        total_points: (prev.total_points || 0) + pointsEarned,
        problems_solved: isCorrect ? (prev.problems_solved || 0) + 1 : (prev.problems_solved || 0),
        current_streak: newStreak
      };
    });
    
    await new Promise(resolve => setTimeout(resolve, 300));
    
    await updateLeaderboard();
  }, [user, updateLeaderboard]);
  const [userRank, setUserRank] = useState<number>(0);
  const [existingSubmission, setExistingSubmission] = useState<{ selected_answer: string; is_correct: boolean } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Accounts are shared with the Problem of the Week site, so a logged-in
  // user may not have a POTM profile yet. Create it, then refresh the
  // leaderboard so their stats show up.
  useEffect(() => {
    setPotmProfileReady(false);
    if (!user?.id) return;
    supabase.rpc("ensure_potm_profile").then(({ error }) => {
      if (error) console.error("Error creating POTM profile:", error);
      setPotmProfileReady(true);
    });
  }, [user?.id]);

  const fetchProblemAndSubmission = useCallback(async () => {
    if (!currentProblem?.id || !user?.id) return;

    const { data: submission } = await supabase
      .from("potm_submissions")
      .select("selected_answer, is_correct")
      .eq("user_id", user.id)
      .eq("problem_id", currentProblem.id)
      .maybeSingle();

    setExistingSubmission(submission);
  }, [currentProblem?.id, user?.id]);

  const getProblemSubmissionIndices = async (problemId: string | null) => {
    if (!problemId) return new Map();
    
    const { data: problem, error } = await supabase
      .from('potm_problems')
      .select('submitted_user_ids')
      .eq('id', problemId)
      .single();
      
    if (error) {
      console.error('Error fetching problem submission array:', error);
      return new Map();
    }
    
    const submissionIndices = new Map<string, number>();
    if (problem) {
      const problemWithArray = problem as { submitted_user_ids?: string[] };
      if (problemWithArray.submitted_user_ids && Array.isArray(problemWithArray.submitted_user_ids)) {
        problemWithArray.submitted_user_ids.forEach((userId: string, index: number) => {
          submissionIndices.set(userId, index);
        });
      }
    }
    
    return submissionIndices;
  };

  const fetchData = useCallback(async () => {
    console.log('Fetching data...');
    setLoading(true);
    try {
      const { data: problems } = await supabase
        .from("potm_problems")
        .select("*")
        .eq("is_active", true)
        .order("month", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(2);
        
      if (problems && problems.length > 0) {
        const current = problems[0] as Problem;
        setCurrentProblem(current);
        
        if (problems.length > 1) {
          const previous = problems[1] as Problem;
          setPreviousProblem(previous);
        } else {
          setPreviousProblem(null);
        }
        
        if (user) {
          const { data: submission } = await supabase
            .from("potm_submissions")
            .select("selected_answer, is_correct")
            .eq("user_id", user.id)
            .eq("problem_id", current.id)
            .maybeSingle();
          setExistingSubmission(submission);
        }
      } else {
        setCurrentProblem(null);
        setPreviousProblem(null);
      }
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchProblemAndSubmission();
  }, [fetchProblemAndSubmission]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (currentProblem) {
      updateLeaderboard();
    }
  }, [currentProblem, previousProblem, updateLeaderboard]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setUserProfile(null);
    setExistingSubmission(null);
  };

  return (
    <div className="min-h-screen bg-background geometric-bg">
      <Header user={user ? { email: user.email ?? "" } : null} onLogout={handleLogout} />

      <main className="container mx-auto px-4 py-8">
        {/* Hero Section */}
        <section className="mb-8 text-center">
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold mb-4 tracking-wider">
            <span className="text-gradient">PROBLEM OF THE MONTH</span>
          </h2>
          <p className="text-lg text-muted-foreground max-w-3xl mx-auto">
            Challenge yourself with monthly math problems. Top scorers get a prize at the end of the year!
          </p>
        </section>

        {/* User Stats (if logged in) */}
        {user && userProfile && (
          <div className="mb-8 max-w-md mx-auto">
            <StatsCard
              totalPoints={userProfile.total_points}
              problemsSolved={userProfile.problems_solved}
              rank={userRank}
            />
          </div>
        )}

        {/* Tabs */}
        <Tabs defaultValue="problem" className="w-full">
          <TabsList className="grid w-full max-w-md mx-auto grid-cols-2 mb-8">
            <TabsTrigger value="problem" className="font-display tracking-wide">
              <Brain className="w-4 h-4 mr-2" />
              PROBLEM
            </TabsTrigger>
            <TabsTrigger value="leaderboard" className="font-display tracking-wide">
              <Trophy className="w-4 h-4 mr-2" />
              LEADERBOARD
            </TabsTrigger>
          </TabsList>

          <TabsContent value="problem" className="max-w-3xl mx-auto">
            

            {loading ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  Loading problem...
                </CardContent>
              </Card>
            ) : currentProblem ? (
              <ProblemCard
                problem={currentProblem}
                userId={user?.id}
                existingSubmission={existingSubmission}
                setExistingSubmission={setExistingSubmission}
                onPointsUpdate={handlePointsUpdate}
                onSubmissionComplete={async () => {
                  try {
                    await fetchProblemAndSubmission();
                    
                    await updateLeaderboard();
                  } catch (error) {
                    console.error("Error refreshing data:", error);
                  }
                }}
              />
            ) : (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <Brain className="w-12 h-12 mx-auto mb-4 opacity-30" />
                  <p className="text-lg">No active problem this month.</p>
                  <p className="text-sm">Check back soon!</p>
                </CardContent>
              </Card>
            )}

            {/* Tips Card */}
            <Card variant="glass" className="mt-6">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2 tracking-wide">
                  <TrendingUp className="w-5 h-5 text-success" />
                  HOW TO EARN POINTS
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <span className="text-primary font-bold">•</span>
                    <span>Full credit for correct answers</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary font-bold">•</span>
                    <span>10% partial credit for attempts</span>
                  </li>
                
                </ul>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="leaderboard" className="max-w-2xl mx-auto">
            <Card variant="default">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 tracking-wider">
                  <Trophy className="w-6 h-6 text-gold" />
                  TOP SCORERS
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="this-year" className="w-full">
                  <TabsList className="grid w-full grid-cols-2 mb-6">
                    <TabsTrigger value="this-year">This Year</TabsTrigger>
                    <TabsTrigger value="all-time">All-Time</TabsTrigger>
                  </TabsList>

                  <TabsContent value="this-year">
                    <Leaderboard
                      key={`leaderboard-${leaderboard.length}-${userProfile?.total_points || 0}`}
                      entries={leaderboard}
                      currentUserId={user?.id}
                      title={user?.id ? '' : ''}
                    />
                  </TabsContent>

                  <TabsContent value="all-time">
                    <Leaderboard
                      key={`all-time-leaderboard-${allTimeLeaderboard.length}`}
                      entries={allTimeLeaderboard}
                      currentUserId={user?.id}
                      title={user?.id ? '' : ''}
                      emptyMessage="No students on the all-time leaderboard yet."
                    />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* Footer */}
      <footer className="border-t border-border mt-12 py-8">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>© 2026 Lincoln Math Club.</p>
        </div>
      </footer>
    </div>
  );
};

export default Index;
