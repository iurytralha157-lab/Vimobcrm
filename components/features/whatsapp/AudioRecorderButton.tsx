 import { useState } from "react";
 import { Button } from "@/components/ui/button";
 import { Mic, Square, X, Send, Loader2 } from "lucide-react";
 import { useAudioRecorder } from "@/hooks/use-audio-recorder";
 import { cn } from "@/lib/utils";
 import { toast } from "@/hooks/use-toast";

 interface AudioRecorderButtonProps {
   onSend: (base64: string, mimetype: string) => Promise<void>;
   disabled?: boolean;
   className?: string;
 }

 export function AudioRecorderButton({ onSend, disabled, className }: AudioRecorderButtonProps) {
   const [isSending, setIsSending] = useState(false);
   const {
     isRecording,
     duration,
     base64,
     audioBlob,
     mimeType,
     startRecording,
     stopRecording,
     cancelRecording,
     clearRecording,
     formatDuration,
   } = useAudioRecorder();

   const handleStartRecording = async () => {
     try {
       await startRecording();
    } catch {
       toast({
         title: "Erro ao gravar áudio",
         description: "Verifique se o microfone está disponível e permitido",
         variant: "destructive",
       });
     }
   };

   const handleSendAudio = async () => {
      if (!base64) return;

      setIsSending(true);
      try {
        await onSend(base64, mimeType || audioBlob?.type || "audio/webm");
        clearRecording();
      } catch (error) {
        console.error("Error sending audio:", error);
        const message = error instanceof Error ? error.message : "Não foi possível enviar o áudio";
        toast({
          title: "Erro ao enviar áudio",
          description: message.includes("RATE_LIMIT")
            ? "Aguarde um momento antes de enviar outra mensagem"
            : message.length < 200 ? message : "Tente novamente em alguns segundos",
          variant: "destructive",
        });
      } finally {
        setIsSending(false);
      }
    };

   // Recording in progress
   if (isRecording) {
     return (
       <div className={cn("flex items-center gap-2 bg-destructive/10 rounded-full px-3 py-1.5", className)}>
         <div className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
         <span className="text-sm font-medium text-destructive min-w-[40px]">
           {formatDuration(duration)}
         </span>
         <Button
           variant="ghost"
           size="icon"
           className="h-8 w-8 text-muted-foreground hover:text-foreground"
           onClick={cancelRecording}
         >
           <X className="h-4 w-4" />
         </Button>
         <Button
           variant="default"
           size="icon"
           className="h-8 w-8"
           onClick={stopRecording}
         >
           <Square className="h-3 w-3 fill-current" />
         </Button>
       </div>
     );
   }

   // Has recorded audio ready to send
   if (base64) {
     return (
       <div className={cn("flex items-center gap-2 bg-primary/10 rounded-full px-3 py-1.5", className)}>
         <span className="text-sm font-medium text-primary">
           Áudio gravado
         </span>
         <Button
           variant="ghost"
           size="icon"
           className="h-8 w-8 text-muted-foreground hover:text-foreground"
           onClick={clearRecording}
         >
           <X className="h-4 w-4" />
         </Button>
         <Button
           variant="default"
           size="icon"
           className="h-8 w-8"
           onClick={handleSendAudio}
           disabled={isSending}
         >
           {isSending ? (
             <Loader2 className="h-4 w-4 animate-spin" />
           ) : (
             <Send className="h-4 w-4" />
           )}
         </Button>
       </div>
     );
   }

   // Default mic button
   return (
     <Button
       variant="ghost"
       size="icon"
       className={cn("h-10 w-10 shrink-0", className)}
       onClick={handleStartRecording}
       disabled={disabled}
       title="Gravar áudio"
     >
       <Mic className="h-5 w-5" />
     </Button>
   );
 }
