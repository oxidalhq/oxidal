import { Component, type ReactNode } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { StateNotice } from '@oxidal/design-system/components/states';

/** A failed screen download cannot take down navigation or confirmed readback.
 * @see docs/interface.md
 */
export class FeatureBoundary extends Component<
  { name: string; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <StateNotice
        kind="error"
        title={`Could not open ${this.props.name}`}
        action={
          <Button variant="outline" onClick={() => window.location.reload()}>
            Reload interface
          </Button>
        }
      >
        The device keeps running. Check your connection, then reload the
        interface.
      </StateNotice>
    );
  }
}
