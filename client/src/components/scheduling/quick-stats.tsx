import { Card, CardContent } from "@/components/ui/card";

interface QuickStatsProps {
  stats: {
    label: string;
    value: number | string;
    color?: string;
  }[];
}

export function QuickStats({ stats }: QuickStatsProps) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {stats.map((stat, index) => (
            <div key={index} className="text-center">
              <p className="text-sm text-slate-600 mb-1">{stat.label}</p>
              <p className={`text-2xl font-bold ${stat.color || ''}`}>
                {stat.value}
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
