export interface BmsCellPayload {
  index: number;
  voltage: number; // volt, hasil kalibrasi voltage divider
}

export interface BmsPackPayload {
  index: number;
  temperature: number; // celsius, dari DS18B20
  balancerConnected: boolean; // status EK-C8S5A
  cells: BmsCellPayload[];
}

export interface BmsDevicePayload {
  timestamp: number; // unix ms dari firmware
  packs: BmsPackPayload[];
}