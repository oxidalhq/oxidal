import type { MidiMap, Status2, SwitchInput } from '../../generated/contract';

export function observedSwitchInputs(
  status: Status2 | undefined,
  map: MidiMap | null,
): SwitchInput[] {
  if (!status || !map?.input) return [];
  const configured = [
    { input: map.input, channel: map.channel },
    ...(map.extra_inputs ?? []),
  ];
  const inputs: SwitchInput[] = [];
  for (const { source = 0, message } of status.recent ?? []) {
    if (message.kind !== 'control' || message.value < 64) continue;
    const port = status.input_ports?.[source];
    const connected =
      source === 0 ? status.connected : status.sources?.[source - 1]?.connected;
    const selected = configured[source];
    if (
      !connected ||
      !port ||
      selected?.input !== port ||
      (selected.channel !== 0 && selected.channel !== message.channel)
    )
      continue;
    const input = {
      port,
      channel: message.channel,
      controller: message.controller,
    };
    if (!inputs.some((i) => sameSwitchInput(i, input))) inputs.push(input);
  }
  return inputs;
}
export function sameSwitchInput(
  a: SwitchInput | null | undefined,
  b: SwitchInput | null | undefined,
) {
  return (
    a?.port === b?.port &&
    a?.channel === b?.channel &&
    a?.controller === b?.controller
  );
}
