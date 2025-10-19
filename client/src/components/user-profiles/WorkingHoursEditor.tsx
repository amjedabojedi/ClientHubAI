import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Clock } from "lucide-react";

interface WorkingHoursEditorProps {
  value?: string; // JSON string
  onChange: (value: string) => void;
}

interface DayHours {
  enabled: boolean;
  start: string;
  end: string;
}

interface WorkingHours {
  [key: string]: DayHours;
}

const DAYS_OF_WEEK = [
  { key: 'monday', label: 'Monday' },
  { key: 'tuesday', label: 'Tuesday' },
  { key: 'wednesday', label: 'Wednesday' },
  { key: 'thursday', label: 'Thursday' },
  { key: 'friday', label: 'Friday' },
  { key: 'saturday', label: 'Saturday' },
  { key: 'sunday', label: 'Sunday' },
];

const DEFAULT_HOURS: WorkingHours = {
  monday: { enabled: true, start: '09:00', end: '17:00' },
  tuesday: { enabled: true, start: '09:00', end: '17:00' },
  wednesday: { enabled: true, start: '09:00', end: '17:00' },
  thursday: { enabled: true, start: '09:00', end: '17:00' },
  friday: { enabled: true, start: '09:00', end: '17:00' },
  saturday: { enabled: false, start: '09:00', end: '17:00' },
  sunday: { enabled: false, start: '09:00', end: '17:00' },
};

export function WorkingHoursEditor({ value, onChange }: WorkingHoursEditorProps) {
  const [hours, setHours] = useState<WorkingHours>(() => {
    if (value) {
      try {
        return JSON.parse(value);
      } catch {
        return DEFAULT_HOURS;
      }
    }
    return DEFAULT_HOURS;
  });

  // Update parent whenever hours change
  useEffect(() => {
    onChange(JSON.stringify(hours));
  }, [hours, onChange]);

  const updateDay = (day: string, field: 'enabled' | 'start' | 'end', newValue: boolean | string) => {
    setHours(prev => ({
      ...prev,
      [day]: {
        ...prev[day],
        [field]: newValue,
      },
    }));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Clock className="h-5 w-5" />
          Working Hours
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {DAYS_OF_WEEK.map(({ key, label }) => (
            <div key={key} className="flex items-center gap-4">
              <div className="flex items-center space-x-2 w-32">
                <Checkbox
                  id={`day-${key}`}
                  checked={hours[key]?.enabled || false}
                  onCheckedChange={(checked) => 
                    updateDay(key, 'enabled', checked === true)
                  }
                  data-testid={`checkbox-working-${key}`}
                />
                <Label htmlFor={`day-${key}`} className="cursor-pointer">
                  {label}
                </Label>
              </div>
              
              {hours[key]?.enabled && (
                <div className="flex items-center gap-2 flex-1">
                  <Input
                    type="time"
                    value={hours[key]?.start || '09:00'}
                    onChange={(e) => updateDay(key, 'start', e.target.value)}
                    className="w-32"
                    data-testid={`input-start-${key}`}
                  />
                  <span className="text-muted-foreground">to</span>
                  <Input
                    type="time"
                    value={hours[key]?.end || '17:00'}
                    onChange={(e) => updateDay(key, 'end', e.target.value)}
                    className="w-32"
                    data-testid={`input-end-${key}`}
                  />
                </div>
              )}
              
              {!hours[key]?.enabled && (
                <span className="text-sm text-muted-foreground">Not available</span>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
