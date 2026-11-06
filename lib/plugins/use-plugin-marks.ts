"use client";

import { useEffect, useState } from "react";
import type { PluginMarks } from "./logos";

let loaded: PluginMarks | null = null;
let loading: Promise<PluginMarks> | null = null;

/** Loads the bundled plugin marks once per window; their chunk loads with the first logo drawn. */
const loadPluginMarks = (): Promise<PluginMarks> => {
    loading ??= import("./plugin-marks").then(({ PLUGIN_MARKS }) => {
        loaded = PLUGIN_MARKS;
        return PLUGIN_MARKS;
    });
    return loading;
};

/** The bundled plugin marks, or null until their chunk has loaded. */
export const usePluginMarks = (): PluginMarks | null => {
    const [marks, setMarks] = useState<PluginMarks | null>(loaded);
    useEffect(() => {
        if (marks) return;
        let current = true;
        loadPluginMarks()
            .then((next) => {
                if (current) setMarks(next);
            })
            .catch(() => undefined);
        return () => {
            current = false;
        };
    }, [marks]);
    return marks;
};
