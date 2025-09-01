// ===== SHARED TASK UTILITY FUNCTIONS =====
// Consolidated utility functions used across dashboard and task components

export const getPriorityColor = (priority: string) => {
  switch (priority) {
    case 'urgent': return 'bg-red-100 text-red-800 border-red-200';
    case 'high': return 'bg-orange-100 text-orange-800 border-orange-200';
    case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'low': return 'bg-green-100 text-green-800 border-green-200';
    default: return 'bg-gray-100 text-gray-800 border-gray-200';
  }
};

export const getStatusColor = (status: string) => {
  switch (status) {
    case 'completed': return 'bg-green-100 text-green-800 border-green-200';
    case 'scheduled': return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'cancelled': return 'bg-red-100 text-red-800 border-red-200';
    case 'no_show': return 'bg-gray-100 text-gray-800 border-gray-200';
    case 'in_progress': return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'overdue': return 'bg-red-100 text-red-800 border-red-200';
    case 'pending': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    default: return 'bg-gray-100 text-gray-800 border-gray-200';
  }
};

export const formatDate = (dateString: string | Date | null) => {
  if (!dateString) return 'No due date';
  if (typeof dateString === 'string') {
    // For ISO strings, extract just the date part to avoid timezone conversion
    return dateString.split('T')[0];
  }
  // For Date objects, format to YYYY-MM-DD to avoid timezone issues
  return dateString.toISOString().split('T')[0];
};

export const formatTime = (timeString: string) => {
  return new Date(`2000-01-01T${timeString}`).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
};

// Client status and stage utility functions
export const getClientStatusColor = (status: string) => {
  switch (status) {
    case 'active': return 'bg-green-100 text-green-800';
    case 'inactive': return 'bg-gray-100 text-gray-800';
    case 'pending': return 'bg-yellow-100 text-yellow-800';
    default: return 'bg-gray-100 text-gray-800';
  }
};

export const getClientStageColor = (stage: string) => {
  switch (stage) {
    case 'intake': return 'bg-blue-100 text-blue-800';
    case 'assessment': return 'bg-purple-100 text-purple-800';
    case 'psychotherapy': return 'bg-green-100 text-green-800';
    default: return 'bg-gray-100 text-gray-800';
  }
};