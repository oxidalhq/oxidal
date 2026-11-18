import * as React from 'react';

import { type CaptureSize, NamBlockTools } from './nam-block';

export function NamBlockToolsDemo({
  fromTone3000 = true,
}: {
  fromTone3000?: boolean;
}) {
  const [size, setSize] = React.useState<CaptureSize>('standard');
  const [mine, setMine] = React.useState(!fromTone3000);
  const [separated, setSeparated] = React.useState(false);
  return (
    <NamBlockTools
      size={size}
      capture={{ name: 'Plexi 50', mine, credit: 'Jane Capture · CC BY 4.0' }}
      separated={separated}
      onSize={setSize}
      onSaveCopy={() => setMine(true)}
      onReload={() => {}}
      onSeparate={() => setSeparated(true)}
    />
  );
}
