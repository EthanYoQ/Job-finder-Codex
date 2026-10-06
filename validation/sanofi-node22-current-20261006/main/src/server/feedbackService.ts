export interface RequestContext {
  ip: string;
  userAgent: string;
}

export interface FeedbackInput {
  issueType: string;
  description: string;
  contact?: string;
  companyId?: string;
  jobId?: string;
}

export interface RecommendedCompanyInput {
  companyName: string;
  officialWebsiteUrl: string;
}

export interface FeedbackReceipt {
  id: string;
  status: "OPEN";
}

type FeedbackCreateRecord = {
  id: string;
};

export interface FeedbackDb {
  feedback: {
    create(args: {
      data: {
        issueType: string;
        description: string;
        contact?: string;
        companyId?: string;
        jobId?: string;
        ip: string;
        userAgent: string;
        status: "OPEN";
      };
    }): Promise<FeedbackCreateRecord>;
  };
  recommendedCompany: {
    create(args: {
      data: {
        companyName: string;
        officialWebsiteUrl: string;
        ip: string;
        userAgent: string;
        status: "OPEN";
      };
    }): Promise<FeedbackCreateRecord>;
  };
}

export async function createFeedback(
  input: FeedbackInput,
  context: RequestContext,
  db: FeedbackDb
): Promise<FeedbackReceipt> {
  const created = await db.feedback.create({
    data: {
      issueType: input.issueType,
      description: input.description,
      ip: context.ip,
      userAgent: context.userAgent,
      status: "OPEN",
      ...(input.contact === undefined ? {} : { contact: input.contact }),
      ...(input.companyId === undefined ? {} : { companyId: input.companyId }),
      ...(input.jobId === undefined ? {} : { jobId: input.jobId })
    }
  });

  return { id: created.id, status: "OPEN" };
}

export async function createRecommendedCompany(
  input: RecommendedCompanyInput,
  context: RequestContext,
  db: FeedbackDb
): Promise<FeedbackReceipt> {
  const created = await db.recommendedCompany.create({
    data: {
      companyName: input.companyName,
      officialWebsiteUrl: input.officialWebsiteUrl,
      ip: context.ip,
      userAgent: context.userAgent,
      status: "OPEN"
    }
  });

  return { id: created.id, status: "OPEN" };
}
