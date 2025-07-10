// Icon Utility Functions for Performance Optimization
// This file centralizes icon configuration to avoid heavy icon library imports

import { 
  Users, 
  CalendarCheck, 
  ClipboardList, 
  Lightbulb, 
  TrendingUp,
  Download,
  Upload,
  Plus,
  Home,
  ArrowLeft,
  Search,
  Filter,
  Edit,
  Trash2,
  Eye,
  Phone,
  Mail,
  MapPin,
  Clock,
  User,
  Calendar,
  FileText,
  FolderOpen,
  CreditCard,
  CheckSquare
} from "lucide-react";

// Icon size configurations for consistent performance
export const ICON_SIZES = {
  xs: "w-3 h-3",
  sm: "w-4 h-4", 
  md: "w-5 h-5",
  lg: "w-6 h-6",
  xl: "w-8 h-8"
} as const;

// Commonly used icons exported for easy reuse
export const COMMON_ICONS = {
  // Navigation
  home: Home,
  back: ArrowLeft,
  
  // Actions
  add: Plus,
  edit: Edit,
  delete: Trash2,
  view: Eye,
  search: Search,
  filter: Filter,
  download: Download,
  upload: Upload,
  
  // Content types
  user: User,
  users: Users,
  calendar: Calendar,
  file: FileText,
  folder: FolderOpen,
  card: CreditCard,
  checklist: CheckSquare,
  
  // Contact info
  phone: Phone,
  email: Mail,
  location: MapPin,
  
  // Status/UI
  clock: Clock,
  calendar_check: CalendarCheck,
  clipboard: ClipboardList,
  lightbulb: Lightbulb,
  trending: TrendingUp
} as const;

// Performance-optimized icon component wrapper
export function OptimizedIcon({ 
  icon: Icon, 
  size = "sm", 
  className = "" 
}: {
  icon: typeof Users;
  size?: keyof typeof ICON_SIZES;
  className?: string;
}) {
  return <Icon className={`${ICON_SIZES[size]} ${className}`} />;
}

// Get icon class for consistent sizing
export function getIconClass(size: keyof typeof ICON_SIZES = "sm", additionalClasses = ""): string {
  return `${ICON_SIZES[size]} ${additionalClasses}`.trim();
}