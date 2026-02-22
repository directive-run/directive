export interface WeatherData {
  temperature: number;
  condition: string;
  humidity: number;
}

const CONDITIONS = ["Sunny", "Cloudy", "Rainy", "Windy", "Foggy", "Stormy", "Clear", "Snowy"];

export async function mockFetchWeather(city: string, delay: number): Promise<WeatherData> {
  await new Promise((resolve) => setTimeout(resolve, delay));
  const hash = [...city.toLowerCase()].reduce((a, c) => a + c.charCodeAt(0), 0);

  return {
    temperature: 32 + (hash % 68),
    condition: CONDITIONS[hash % CONDITIONS.length],
    humidity: 20 + (hash % 60),
  };
}
