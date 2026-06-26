import { Component, ReactNode } from "react";
import { AlertCircle } from "lucide-react";

interface MessageErrorBoundaryProps {
  children: ReactNode;
  messageId?: string;
}

interface MessageErrorBoundaryState {
  hasError: boolean;
}

export class MessageErrorBoundary extends Component<MessageErrorBoundaryProps, MessageErrorBoundaryState> {
  state: MessageErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): MessageErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    console.error("[WhatsApp Message Render Error]", {
      messageId: this.props.messageId,
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex justify-center py-1">
          <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-muted-foreground">
            <AlertCircle className="h-3.5 w-3.5 text-destructive" />
            Mensagem indisponível
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
