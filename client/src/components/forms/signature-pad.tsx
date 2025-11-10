import { useRef, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Eraser, RotateCcw, PenTool, Type } from "lucide-react";

interface SignaturePadProps {
  onSave: (dataUrl: string) => void;
  initialSignature?: string;
  disabled?: boolean;
}

export function SignaturePad({ onSave, initialSignature, disabled = false }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [signatureMode, setSignatureMode] = useState<"draw" | "type">("type");
  const [typedName, setTypedName] = useState("");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (initialSignature) {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        setHasDrawn(true);
      };
      img.src = initialSignature;
    } else {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, [initialSignature]);

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = "touches" in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = "touches" in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
    setHasDrawn(true);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing || disabled) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = "touches" in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = "touches" in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    saveSignature();
  };

  const saveSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawn) return;

    const dataUrl = canvas.toDataURL("image/png");
    onSave(dataUrl);
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
    onSave("");
  };

  const generateTypedSignature = (name: string) => {
    const canvas = canvasRef.current;
    if (!canvas || !name.trim()) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#000000";
    ctx.font = "48px 'Dancing Script', 'Brush Script MT', cursive";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(name, canvas.width / 2, canvas.height / 2);

    setHasDrawn(true);
    const dataUrl = canvas.toDataURL("image/png");
    onSave(dataUrl);
  };

  const handleTypedNameChange = (name: string) => {
    setTypedName(name);
    if (name.trim()) {
      generateTypedSignature(name);
    } else {
      clearSignature();
    }
  };

  if (disabled) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className={`border-2 rounded-lg overflow-hidden opacity-50 border-gray-300`}>
            <canvas
              ref={canvasRef}
              width={600}
              height={200}
              className="w-full"
              data-testid="signature-canvas"
            />
          </div>
          <p className="text-sm text-gray-500 text-center mt-4">
            Electronic signature (read-only)
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4">
        <Tabs value={signatureMode} onValueChange={(v) => {
          setSignatureMode(v as "draw" | "type");
          clearSignature();
          setTypedName("");
        }}>
          <TabsList className="grid w-full grid-cols-2 mb-4">
            <TabsTrigger value="type" data-testid="tab-type-signature">
              <Type className="w-4 h-4 mr-2" />
              Type Name
            </TabsTrigger>
            <TabsTrigger value="draw" data-testid="tab-draw-signature">
              <PenTool className="w-4 h-4 mr-2" />
              Draw Signature
            </TabsTrigger>
          </TabsList>

          <div className="space-y-4">
            {signatureMode === "type" && (
              <div className="space-y-2">
                <Input
                  type="text"
                  placeholder="Type your full name"
                  value={typedName}
                  onChange={(e) => handleTypedNameChange(e.target.value)}
                  className="text-lg"
                  data-testid="input-typed-signature"
                />
                <p className="text-sm text-gray-500">
                  Your typed name will be used as your electronic signature
                </p>
              </div>
            )}

            <div className={`border-2 rounded-lg overflow-hidden ${signatureMode === "draw" ? 'border-gray-300' : (!typedName.trim() ? 'opacity-30 border-gray-200' : 'border-gray-300')}`}>
              <canvas
                ref={canvasRef}
                width={600}
                height={200}
                className="w-full bg-white"
                onMouseDown={signatureMode === "draw" ? startDrawing : undefined}
                onMouseMove={signatureMode === "draw" ? draw : undefined}
                onMouseUp={signatureMode === "draw" ? stopDrawing : undefined}
                onMouseLeave={signatureMode === "draw" ? stopDrawing : undefined}
                onTouchStart={signatureMode === "draw" ? startDrawing : undefined}
                onTouchMove={signatureMode === "draw" ? draw : undefined}
                onTouchEnd={signatureMode === "draw" ? stopDrawing : undefined}
                style={{ cursor: signatureMode === "draw" ? 'crosshair' : 'default', touchAction: signatureMode === "draw" ? 'none' : 'auto' }}
                data-testid="signature-canvas"
              />
            </div>

            {signatureMode === "draw" && (
              <div className="flex justify-between items-center">
                <p className="text-sm text-gray-500">
                  {hasDrawn ? "Signature captured" : "Sign above using your mouse or touch screen"}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={clearSignature}
                  disabled={!hasDrawn}
                  data-testid="button-clear-signature"
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Clear
                </Button>
              </div>
            )}
          </div>
        </Tabs>
      </CardContent>
    </Card>
  );
}
