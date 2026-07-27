import React, { Component, ReactNode } from 'react';
import { useLanguage } from '../context/LanguageContext';

interface Props {
  children: ReactNode;
  labels: {
    title: string;
    description: string;
    reload: string;
  };
}

interface State {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundaryCore extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="text-center p-8 bg-white rounded-lg shadow-md">
            <h1 className="text-2xl font-bold text-red-600 mb-4">{this.props.labels.title}</h1>
            <p className="text-gray-600 mb-4">{this.props.labels.description}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              {this.props.labels.reload}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export const ErrorBoundary: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { t } = useLanguage();
  return (
    <ErrorBoundaryCore labels={{ title: t('error.title'), description: t('error.description'), reload: t('error.reload') }}>
      {children}
    </ErrorBoundaryCore>
  );
};
