export interface PxMatch {
    fullMatch: string;
    value: number;
    index: number;
    isInCalc: boolean;
}

export interface ExtensionConfig {
    preserveZero: boolean;
    excludePatterns: string[];
    excludeFiles: string[];
    fileTypes: string[];
    keepPxInRem: boolean;
    scssInterpolation: boolean;
    directConversion: boolean;
    baseFontSize: number;
    minValue: number;
    maxValue: number;
    includeProperties: string[];
    excludeProperties: string[];
    enableDiagnostics: boolean;
    enableCodeLens: boolean;
    diagnosticSeverity: string;
    enableReverseHover: boolean;
    useDynamicBaseFontSize: boolean;
    baseFontSizeFile: string;
    baseFontSizeVariable: string;
}

export interface ConversionStats {
    totalMatches: number;
    convertedCount: number;
    skippedCount: number;
    duration: number;
}
