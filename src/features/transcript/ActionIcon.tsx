import {
  BarChart3, BookA, Bookmark, BookOpen, CalendarClock, CircleHelp, FileText, GraduationCap, HelpCircle, Languages, ListChecks, ListOrdered, ListTree, Lightbulb,
  MessageCircleQuestion, Network, NotebookPen, Quote, ScrollText, Sparkles, Star, Wand2, type LucideIcon,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  BarChart3, BookA, Bookmark, BookOpen, CalendarClock, CircleHelp, FileText, GraduationCap, HelpCircle, Languages, ListChecks, ListOrdered, ListTree, Lightbulb,
  MessageCircleQuestion, Network, NotebookPen, Quote, ScrollText, Star, Wand2,
};

export function ActionIcon({ name, size = 18 }: { name: string; size?: number }) {
  const Icon = ICONS[name] ?? Sparkles;
  return <Icon size={size} aria-hidden />;
}
