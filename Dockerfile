FROM public.ecr.aws/lambda/nodejs:20

COPY . ./

CMD ["dist/handler.handler"]