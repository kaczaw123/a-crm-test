import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    console.error("Uncaught error in ErrorBoundary:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="p-6 m-6 bg-[#FEF2F2] border border-[#FCA5A5] rounded-xl shadow-sm">
          <div className="flex items-center gap-3 mb-4">
             <span className="material-symbols-outlined text-[32px] text-[#991B1B]">dangerous</span>
             <div>
               <h2 className="text-[#991B1B] text-lg font-bold">Krytyczny błąd interfejsu (React Crash)</h2>
               <p className="text-[#B91C1C] text-[13px] font-medium">Biały ekran (White Screen of Death) został przechwycony przez ErrorBoundary.</p>
             </div>
          </div>
          <pre className="bg-white p-4 rounded-lg text-[11px] text-[#7F1D1D] border border-[#FECACA] overflow-auto max-h-96 whitespace-pre-wrap font-mono shadow-inner">
            <span className="font-bold border-b border-[#FECACA] block pb-2 mb-2">{this.state.error?.toString()}</span>
            {this.state.errorInfo?.componentStack}
          </pre>
        </div>
      );
    }

    return this.props.children;
  }
}
