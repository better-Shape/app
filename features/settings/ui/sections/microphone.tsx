"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useIsMounted } from "@/lib/ui/use-mounted";
import { Button } from "@/components/ui/button";
import { microphoneConstraints, microphoneErrorMessage, updateSettingSection, useSettings } from "@/lib/settings";
import { SettingRow, SettingSection, SettingSelect } from "../shared/controls";

type MicOption = { value: string; label: string };

async function listMicrophones(): Promise<MicOption[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [{ value: "default", label: "Default" }];
    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = devices.filter((device) => device.kind === "audioinput");
    const options: MicOption[] = [{ value: "default", label: "Default" }];
    mics.forEach((device, index) => {
        if (!device.deviceId || device.deviceId === "default") return;
        options.push({
            value: device.deviceId,
            label: device.label || `Microphone ${index + 1}`,
        });
    });
    return options;
}

export function MicrophoneSettings() {
    const deviceId = useSettings().voice.deviceId;
    const [options, setOptions] = useState<MicOption[]>([{ value: "default", label: "Default" }]);
    const [busy, setBusy] = useState(false);
    const [level, setLevel] = useState(0);
    const [listening, setListening] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const stopRef = useRef<(() => void) | null>(null);
    // Read after mount: the server has no navigator, so branching during render
    // rendered one description on the server and another on the client.
    const mounted = useIsMounted();
    const unavailable = mounted && !navigator.mediaDevices?.getUserMedia;

    const refresh = useCallback(async () => {
        const next = await listMicrophones();
        setOptions(next);
        return next;
    }, []);

    useEffect(() => {
        let disposed = false;
        void listMicrophones().then(next => {
            if (!disposed) setOptions(next);
        }).catch(cause => {
            if (!disposed) setError(microphoneErrorMessage(cause));
        });
        return () => { disposed = true; stopRef.current?.(); };
    }, []);

    const allowAndRefresh = async () => {
        if (unavailable) return;
        setBusy(true);
        setError(null);
        // Held outside the try so a failure after the device opened can still
        // release it; otherwise a broken AudioContext leaves the mic live.
        let opened: MediaStream | null = null;
        try {
            opened = await navigator.mediaDevices.getUserMedia({
                audio: microphoneConstraints(deviceId),
            });
            const stream = opened;
            stream.getTracks().forEach((track) => track.stop());
            await refresh();
        } catch (err) {
            setError(microphoneErrorMessage(err));
        } finally {
            setBusy(false);
        }
    };

    const testInput = async () => {
        if (listening) {
            stopRef.current?.();
            return;
        }
        if (unavailable) return;
        setBusy(true);
        setError(null);
        // Held outside the try so a failure after the device opened can still
        // release it; otherwise a broken AudioContext leaves the mic live.
        let opened: MediaStream | null = null;
        try {
            opened = await navigator.mediaDevices.getUserMedia({
                audio: microphoneConstraints(deviceId),
            });
            const stream = opened;
            const ctx = new AudioContext();
            const source = ctx.createMediaStreamSource(stream);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);
            const data = new Uint8Array(analyser.fftSize);
            let frame = 0;
            let stopped = false;
            const timer = window.setTimeout(() => stop(), 4000);
            const stop = () => {
                if (stopped) return;
                stopped = true;
                window.clearTimeout(timer);
                cancelAnimationFrame(frame);
                stream.getTracks().forEach((track) => track.stop());
                void ctx.close();
                stopRef.current = null;
                setListening(false);
                setLevel(0);
            };
            stopRef.current = stop;
            setListening(true);
            const tick = () => {
                if (stopped) return;
                analyser.getByteTimeDomainData(data);
                let max = 0;
                for (let i = 0; i < data.length; i++) max = Math.max(max, Math.abs((data[i] ?? 128) - 128) / 128);
                setLevel(max);
                frame = requestAnimationFrame(tick);
            };
            frame = requestAnimationFrame(tick);
            await refresh();
        } catch (err) {
            opened?.getTracks().forEach((track) => track.stop());
            setListening(false);
            setError(microphoneErrorMessage(err));
        } finally {
            setBusy(false);
        }
    };

    const known = options.some((option) => option.value === deviceId);
    const selectOptions = known ? options : [...options, { value: deviceId, label: "Saved microphone" }];

    return (
        <SettingSection id="settings-microphone" title="Microphone">
            <SettingRow title="Input" description="Voice notes use this microphone. The system still asks the first time.">
                <SettingSelect
                    value={deviceId}
                    options={selectOptions}
                    onChange={(value) => updateSettingSection("voice", { deviceId: value })}
                />
            </SettingRow>
            <SettingRow
                title="Devices"
                description={
                    unavailable
                        ? "Microphone access isn't available in this window."
                        : error
                          ? error
                          : listening
                            ? "Listening..."
                            : "Names show up after access is allowed."
                }
            >
                <div className="flex items-center gap-2">
                    {listening ? (
                        <span className="h-2 w-24 overflow-hidden rounded-full bg-surface-3" aria-hidden>
                            <span
                                className="block h-full rounded-full bg-accent"
                                style={{ width: `${Math.max(8, Math.round(level * 100))}%` }}
                            />
                        </span>
                    ) : null}
                    <Button type="button" variant="secondary" size="sm" disabled={unavailable || (busy && !listening)} onClick={() => void allowAndRefresh()}>
                        Refresh
                    </Button>
                    <Button type="button" variant="secondary" size="sm" disabled={unavailable || (busy && !listening)} onClick={() => void testInput()}>
                        {listening ? "Stop" : "Test"}
                    </Button>
                </div>
            </SettingRow>
        </SettingSection>
    );
}
