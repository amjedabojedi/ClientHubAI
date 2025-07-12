export default function ClientHeader() {
  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
      <div className="max-w-full px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-8">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
                <Users className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900">HealthCare CMS</h1>
                <p className="text-sm text-slate-500">Client Management System</p>
              </div>
            </div>
            

          </div>

          <div className="flex items-center space-x-4">
            <button className="relative p-2 text-slate-600 hover:text-slate-900">
              <i className="fas fa-bell text-lg"></i>
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">3</span>
            </button>
            
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-slate-300 rounded-full"></div>
              <div className="hidden sm:block">
                <p className="text-sm font-medium text-slate-900">Dr. Sarah Johnson</p>
                <p className="text-xs text-slate-500">Licensed Therapist</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
