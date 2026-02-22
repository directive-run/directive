export async function mockServerSync(
  op: string,
  itemId: string,
  delay: number,
  failRate: number,
): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delay));
  if (Math.random() * 100 < failRate) {
    throw new Error(`Server rejected ${op} for item ${itemId}`);
  }
}
