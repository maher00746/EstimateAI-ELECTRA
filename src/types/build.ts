import { Document, Types } from "mongoose";

export interface AttributeValue {
  value: string;
  price?: string;
}

// Support both old format (string) and new format (object with value and price)
export type AttributeMap = Record<string, string | AttributeValue>;

export interface BuildDocument extends Document {
  _id: Types.ObjectId;
  requestId: string;
  createdAt: Date;
  updatedAt: Date;
  originalName: string;
  filePath: string;
  attributes: AttributeMap;
  totalPrice?: string;
}

