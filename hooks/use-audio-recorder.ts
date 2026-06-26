 import { useState, useRef, useCallback } from "react";

 interface AudioRecorderState {
   isRecording: boolean;
   duration: number;
   audioBlob: Blob | null;
   base64: string | null;
   mimeType: string | null;
 }

 export function useAudioRecorder() {
   const [state, setState] = useState<AudioRecorderState>({
     isRecording: false,
     duration: 0,
     audioBlob: null,
     base64: null,
     mimeType: null,
   });

   const mediaRecorderRef = useRef<MediaRecorder | null>(null);
   const chunksRef = useRef<Blob[]>([]);
   const timerRef = useRef<number | null>(null);
   const startTimeRef = useRef<number>(0);

   const startRecording = useCallback(async () => {
     try {
       // Request microphone permission
       const stream = await navigator.mediaDevices.getUserMedia({
         audio: {
           echoCancellation: true,
           noiseSuppression: true,
           sampleRate: 44100,
         }
       });

      const mimeType = MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
        ? 'audio/ogg;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm';

       const mediaRecorder = new MediaRecorder(stream, {
         mimeType,
         audioBitsPerSecond: 128000,
       });

       mediaRecorderRef.current = mediaRecorder;
       chunksRef.current = [];

       mediaRecorder.ondataavailable = (e) => {
         if (e.data.size > 0) {
           chunksRef.current.push(e.data);
         }
       };

       mediaRecorder.onstop = async () => {
         // Stop all tracks
         stream.getTracks().forEach(track => track.stop());

         // Create blob
         const blob = new Blob(chunksRef.current, { type: mimeType });

         // Convert to base64
         const reader = new FileReader();
         reader.onloadend = () => {
           const base64String = reader.result as string;
           // Remove data URL prefix (e.g., "data:audio/webm;base64,")
           const base64 = base64String.split(',')[1];

           setState(prev => ({
             ...prev,
             isRecording: false,
             audioBlob: blob,
             base64,
             mimeType: blob.type || mimeType,
           }));
         };
         reader.readAsDataURL(blob);
       };

       // Start recording
       mediaRecorder.start(100); // Collect data every 100ms
       startTimeRef.current = Date.now();

       // Start duration timer
       timerRef.current = window.setInterval(() => {
         const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
         setState(prev => ({ ...prev, duration: elapsed }));
       }, 100);

       setState({
         isRecording: true,
         duration: 0,
         audioBlob: null,
         base64: null,
         mimeType,
       });

     } catch (error) {
       console.error("Error starting recording:", error);
       throw error;
     }
   }, []);

   const stopRecording = useCallback(() => {
     if (timerRef.current) {
       clearInterval(timerRef.current);
       timerRef.current = null;
     }

     if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
       mediaRecorderRef.current.stop();
     }
   }, []);

   const cancelRecording = useCallback(() => {
     if (timerRef.current) {
       clearInterval(timerRef.current);
       timerRef.current = null;
     }

     if (mediaRecorderRef.current) {
       if (mediaRecorderRef.current.state !== "inactive") {
         mediaRecorderRef.current.stop();
       }
       // Access the stream from the media recorder
       const stream = mediaRecorderRef.current.stream;
       stream?.getTracks().forEach(track => track.stop());
     }

     chunksRef.current = [];
     setState({
       isRecording: false,
       duration: 0,
       audioBlob: null,
       base64: null,
       mimeType: null,
     });
   }, []);

   const clearRecording = useCallback(() => {
     setState({
       isRecording: false,
       duration: 0,
       audioBlob: null,
       base64: null,
       mimeType: null,
     });
   }, []);

   const formatDuration = useCallback((seconds: number) => {
     const mins = Math.floor(seconds / 60);
     const secs = seconds % 60;
     return `${mins}:${secs.toString().padStart(2, '0')}`;
   }, []);

   return {
     ...state,
     startRecording,
     stopRecording,
     cancelRecording,
     clearRecording,
     formatDuration,
   };
 }
