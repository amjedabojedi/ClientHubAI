import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

export default function Pagination({ 
  currentPage, 
  totalPages, 
  pageSize, 
  total, 
  onPageChange, 
  onPageSizeChange 
}: PaginationProps) {
  const startItem = (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, total);

  const getVisiblePages = () => {
    const delta = 2;
    const range = [];
    const rangeWithDots = [];

    for (let i = Math.max(2, currentPage - delta); i <= Math.min(totalPages - 1, currentPage + delta); i++) {
      range.push(i);
    }

    if (currentPage - delta > 2) {
      rangeWithDots.push(1, '...');
    } else {
      rangeWithDots.push(1);
    }

    rangeWithDots.push(...range);

    if (currentPage + delta < totalPages - 1) {
      rangeWithDots.push('...', totalPages);
    } else if (totalPages > 1) {
      rangeWithDots.push(totalPages);
    }

    return rangeWithDots;
  };

  return (
    <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-200">
      <div className="flex items-center space-x-2">
        <span className="text-sm text-slate-600">Rows per page:</span>
        <Select value={pageSize.toString()} onValueChange={(value) => onPageSizeChange(parseInt(value))}>
          <SelectTrigger className="w-20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="25">25</SelectItem>
            <SelectItem value="50">50</SelectItem>
            <SelectItem value="100">100</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <div className="flex items-center space-x-4">
        <span className="text-sm text-slate-600">
          {startItem}-{endItem} of {total.toLocaleString()}
        </span>
        <div className="flex items-center space-x-1">
          <Button 
            variant="ghost" 
            size="sm" 
            disabled={currentPage === 1}
            onClick={() => onPageChange(1)}
          >
            <i className="fas fa-angle-double-left"></i>
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            disabled={currentPage === 1}
            onClick={() => onPageChange(currentPage - 1)}
          >
            <i className="fas fa-angle-left"></i>
          </Button>
          
          <div className="flex items-center space-x-1">
            {getVisiblePages().map((page, index) => (
              page === '...' ? (
                <span key={index} className="px-2 text-slate-400">...</span>
              ) : (
                <Button
                  key={index}
                  variant={currentPage === page ? "default" : "ghost"}
                  size="sm"
                  onClick={() => onPageChange(page as number)}
                  className="min-w-[32px]"
                >
                  {page}
                </Button>
              )
            ))}
          </div>

          <Button 
            variant="ghost" 
            size="sm" 
            disabled={currentPage === totalPages}
            onClick={() => onPageChange(currentPage + 1)}
          >
            <i className="fas fa-angle-right"></i>
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            disabled={currentPage === totalPages}
            onClick={() => onPageChange(totalPages)}
          >
            <i className="fas fa-angle-double-right"></i>
          </Button>
        </div>
      </div>
    </div>
  );
}
