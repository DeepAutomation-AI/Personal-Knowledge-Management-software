import { Component, type ReactNode } from 'react';
import { Compass } from 'lucide-react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <div className="startup-screen">
          <Compass size={42} />
          <h1>Atlas necesita un momento</h1>
          <p>La interfaz encontró un problema. Recarga para volver a abrir tus notas guardadas.</p>
          <button className="primary-button" onClick={() => location.reload()}>
            Volver a abrir Atlas
          </button>
        </div>
      );
    return this.props.children;
  }
}
